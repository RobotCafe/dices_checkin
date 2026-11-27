import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";
import { bcDate } from "@/lib/time";
import type { Program } from "@/lib/types";
import { verifyZeffySignature } from "@/lib/webhookSignature";
import { campaignIdOf, parsePayment } from "@/lib/zeffy";
import { fetchPayment } from "@/lib/zeffyApi";

export const runtime = "nodejs";

/**
 * Zeffy -> app. Configure in Zeffy (Settings > Integrations):
 *   https://YOUR-APP/api/zeffy/webhook?token=<ZEFFY_WEBHOOK_TOKEN>
 * One webhook serves every program: the Zeffy campaign id picks the program.
 * Every delivery must carry a valid Zeffy-Signature (ZEFFY_WEBHOOK_SECRET); the URL token is a second check.
 * Idempotent per Zeffy payment id (Zeffy retries non-2xx for up to 3 days).
 * Events: payment.completed carries the full payment in `data`; payment.updated / payment.deleted carry only
 * { id }, so the current state is fetched from the API (ZEFFY_API_KEY).
 */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!process.env.ZEFFY_WEBHOOK_TOKEN || token !== process.env.ZEFFY_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = await req.text(); // the signature covers these exact bytes
  const sig = verifyZeffySignature(raw, req.headers.get("zeffy-signature"), process.env.ZEFFY_WEBHOOK_SECRET ?? "");
  if (!sig.ok) {
    console.warn(`Zeffy webhook rejected: ${sig.reason}`);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const type: string = body.type ?? "";
  const payment = body.data ?? {};
  const db = adminDb();
  const now = new Date().toISOString();

  if (type === "payment.updated" || type === "payment.deleted") {
    const id = String(payment.id ?? "");
    if (!id) return NextResponse.json({ ok: true, ignored: "no id" });
    const ref = db.collection("payments").doc(id);
    const current = type === "payment.deleted" ? null : await fetchPayment(id); // throws -> 500 -> Zeffy retries
    const update: Record<string, unknown> = { lastEvent: type, lastEventAt: now };
    if (!current) {
      update.needsReview = true;
      update.reviewReason = "Payment deleted in Zeffy";
    } else {
      update.status = current.status ?? null;
      update.refundStatus = current.refund_status ?? "none";
      update.dispute = current.dispute ?? null;
      // Refunds and disputes need a person: void the pass or not. Other changes (receipt, fund) don't.
      if ((current.refund_status && current.refund_status !== "none") || current.dispute) {
        update.needsReview = true;
        update.reviewReason = current.dispute ? `Dispute: ${current.dispute.status ?? "open"}` : `Refund: ${current.refund_status}`;
      }
    }
    await ref.set(update, { merge: true });
    return NextResponse.json({ ok: true });
  }
  if (type !== "payment.completed") {
    // Events the app doesn't act on: keep them (admin-only) for review.
    await db.collection("webhookEvents").add({ type, raw: body, receivedAt: now });
    return NextResponse.json({ ok: true, ignored: type });
  }

  const paymentId = String(payment.id ?? "");
  if (!paymentId) return NextResponse.json({ error: "no payment id" }, { status: 400 });
  const payRef = db.collection("payments").doc(paymentId);

  // Claim the payment atomically so two deliveries arriving together can't both create passes.
  // A claim left by a crashed attempt expires, so Zeffy's next retry still gets processed.
  const claim = await db.runTransaction(async (tx) => {
    const d = (await tx.get(payRef)).data();
    if (d?.processed) return null;
    if (d?.processingSince && Date.now() - Date.parse(d.processingSince) < CLAIM_MS) return null;
    tx.set(payRef, { processingSince: new Date().toISOString() }, { merge: true });
    return { flaggedBefore: d?.needsReview === true && !!d?.lastEvent }; // e.g. a refund event got here first
  });
  if (!claim) return NextResponse.json({ ok: true, duplicate: true });

  try {
    return await processPayment(db, payRef, paymentId, payment, claim.flaggedBefore);
  } catch (e) {
    await payRef.set({ processingSince: FieldValue.delete() }, { merge: true }).catch(() => {});
    throw e; // 500, so Zeffy retries
  }
}

const CLAIM_MS = 120_000;

async function processPayment(
  db: FirebaseFirestore.Firestore,
  payRef: FirebaseFirestore.DocumentReference,
  paymentId: string,
  payment: any,
  flaggedBefore: boolean,
) {
  // Which program is this? Match the Zeffy campaign id.
  const campaignId = campaignIdOf(payment);
  const found = campaignId
    ? await db.collection("programs").where("zeffyCampaignId", "==", campaignId).limit(1).get()
    : null;
  if (!found || found.empty) {
    await payRef.set({
      raw: payment, processed: false, needsReview: true, processingSince: FieldValue.delete(),
      warnings: [`No program is linked to Zeffy campaign "${campaignId || "(none found in payload)"}"`],
      receivedAt: new Date().toISOString(),
    }, { merge: true });
    return NextResponse.json({ ok: true, unmatched: true });
  }
  const program = { id: found.docs[0].id, ...found.docs[0].data() } as Program;
  const { payment: parsed, tickets } = parsePayment(payment, program);

  // Reads first, then one atomic batch of writes.
  const batch = db.batch();
  let householdId: string | null = null;
  if (parsed.buyerEmail) {
    const h = await db.collection("households").where("email", "==", parsed.buyerEmail).where("mergedInto", "==", null).limit(1).get();
    if (!h.empty) householdId = h.docs[0].id;
  }
  const householdRef = householdId ? db.collection("households").doc(householdId) : db.collection("households").doc();
  if (householdId) {
    batch.update(householdRef, { programIds: FieldValue.arrayUnion(program.id) });
  } else {
    batch.set(householdRef, {
      contactName: parsed.buyerName, email: parsed.buyerEmail, phone: parsed.buyerPhone ?? null,
      programIds: [program.id], mergedInto: null,
    });
  }

  const day = bcDate(new Date(parsed.purchasedAt));
  const createdThisPayment = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const t of tickets) {
    const key = `${t.name}|${t.birthDate}`;
    let personRef = createdThisPayment.get(key);
    if (!personRef) {
      const c = await db.collection("people")
        .where("householdId", "==", householdRef.id).where("name", "==", t.name)
        .where("birthDate", "==", t.birthDate).where("mergedInto", "==", null).limit(1).get();
      if (c.empty) {
        personRef = db.collection("people").doc();
        batch.set(personRef, {
          name: t.name, birthDate: t.birthDate, dietary: t.dietary,
          householdId: householdRef.id, programIds: [program.id], mergedInto: null,
        });
      } else {
        personRef = c.docs[0].ref;
        batch.update(personRef, { programIds: FieldValue.arrayUnion(program.id) });
      }
      createdThisPayment.set(key, personRef);
    }
    batch.set(db.collection("passes").doc(), {
      programId: program.id, kind: t.kind, personId: personRef.id, householdId: householdRef.id,
      zeffyPaymentId: paymentId, purchasedAt: parsed.purchasedAt,
      validFrom: day > program.seasonStart ? day : program.seasonStart,
      validThrough: program.seasonEnd,
      punchesTotal: t.punches, status: "active",
    });
  }

  batch.set(payRef, {
    raw: payment, programId: program.id, status: parsed.status, source: parsed.source, refundStatus: parsed.refundStatus,
    warnings: parsed.warnings,
    needsReview: parsed.warnings.length > 0 || flaggedBefore, processed: true, processingSince: FieldValue.delete(),
    receivedAt: new Date().toISOString(),
  }, { merge: true });
  await batch.commit();
  return NextResponse.json({ ok: true });
}
