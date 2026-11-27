import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";
import { bcDate } from "@/lib/time";
import type { Program } from "@/lib/types";
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
  const body = await req.json();
  const type: string = body.type ?? body.event ?? "";
  const payment = body.payment ?? body.data ?? body;
  const db = adminDb();

  // payment.updated / deleted carry only the id (refunds, disputes): flag for staff, don't guess.
  if (type === "payment.updated" || type === "payment.deleted") {
    const id = String(payment.id ?? body.id ?? "");
    if (id) {
      await db.collection("payments").doc(id).set(
        { needsReview: true, lastEvent: type, lastEventAt: new Date().toISOString() },
        { merge: true },
      );
    }
    return NextResponse.json({ ok: true });
  }
  if (type !== "payment.completed") return NextResponse.json({ ok: true, ignored: type });

  const paymentId = String(payment.id ?? "");
  if (!paymentId) return NextResponse.json({ error: "no payment id" }, { status: 400 });
  const payRef = db.collection("payments").doc(paymentId);
  const existing = await payRef.get();
  if (existing.exists && existing.data()?.processed) return NextResponse.json({ ok: true, duplicate: true });

  // Which program is this? Match the Zeffy campaign id.
  const campaignId = campaignIdOf(payment);
  const found = campaignId
    ? await db.collection("programs").where("zeffyCampaignId", "==", campaignId).limit(1).get()
    : null;
  if (!found || found.empty) {
    await payRef.set({
      raw: payment, processed: false, needsReview: true,
      warnings: [`No program is linked to Zeffy campaign "${campaignId || "(none found in payload)"}"`],
      receivedAt: new Date().toISOString(),
    });
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
    raw: payment, programId: program.id, status: parsed.status, warnings: parsed.warnings,
    needsReview: parsed.warnings.length > 0, processed: true, receivedAt: new Date().toISOString(),
  });
  await batch.commit();
  return NextResponse.json({ ok: true });
}
