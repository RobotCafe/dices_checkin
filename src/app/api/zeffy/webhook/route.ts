import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";
import { bcDate } from "@/lib/time";
import type { Program } from "@/lib/types";
import { checkSignature, type SignatureCheck } from "@/lib/webhookSignature";
import { campaignIdOf, parsePayment } from "@/lib/zeffy";

export const runtime = "nodejs";

/**
 * Zeffy -> app. Configure in Zeffy (Settings > Integrations):
 *   https://YOUR-APP/api/zeffy/webhook?token=<ZEFFY_WEBHOOK_TOKEN>
 * One webhook serves every program: the Zeffy campaign id picks the program.
 * Idempotent per Zeffy payment id (Zeffy retries on non-2xx).
 */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!process.env.ZEFFY_WEBHOOK_TOKEN || token !== process.env.ZEFFY_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = await req.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  // OBSERVE mode: record whether Zeffy's signature matched a known scheme; don't reject yet (see webhookSignature.ts).
  const signature = checkSignature(req.headers, raw, process.env.ZEFFY_WEBHOOK_SECRET ?? "");
  const type: string = body.type ?? body.event ?? "";
  const payment = body.payment ?? body.data?.object ?? body.data ?? body;
  const db = adminDb();

  // payment.updated / deleted carry only the id (refunds, disputes): flag for staff, don't guess.
  if (type === "payment.updated" || type === "payment.deleted") {
    const id = String(payment.id ?? body.id ?? "");
    if (id) {
      await db.collection("payments").doc(id).set(
        { needsReview: true, lastEvent: type, lastEventAt: new Date().toISOString(), lastEventRaw: body, signature },
        { merge: true },
      );
    }
    return NextResponse.json({ ok: true });
  }
  if (type !== "payment.completed") {
    // Unknown or test events: keep them (admin-only) so the payload shape can be checked.
    await db.collection("webhookEvents").add({ type, raw: body, signature, receivedAt: new Date().toISOString() });
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
    return await processPayment(db, payRef, paymentId, payment, claim.flaggedBefore, signature);
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
  signature: SignatureCheck,
) {

  // Which program is this? Match the Zeffy campaign id.
  const campaignId = campaignIdOf(payment);
  const found = campaignId
    ? await db.collection("programs").where("zeffyCampaignId", "==", campaignId).limit(1).get()
    : null;
  if (!found || found.empty) {
    await payRef.set({
      raw: payment, signature, processed: false, needsReview: true, processingSince: FieldValue.delete(),
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
    raw: payment, signature, programId: program.id, status: parsed.status, warnings: parsed.warnings,
    needsReview: parsed.warnings.length > 0 || flaggedBefore, processed: true, processingSince: FieldValue.delete(),
    receivedAt: new Date().toISOString(),
  }, { merge: true });
  await batch.commit();
  return NextResponse.json({ ok: true });
}
