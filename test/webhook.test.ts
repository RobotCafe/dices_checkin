// Zeffy webhook against the Firestore emulator: npm run test:rules (runs all emulator tests).
import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { adminDb } from "../src/lib/admin";
import { GROWING_UP_DENMAN } from "../src/lib/programConfig";
import { POST } from "../src/app/api/zeffy/webhook/route";

process.env.ZEFFY_WEBHOOK_TOKEN = "t";
const db = adminDb();

const payment = {
  id: "pay1", status: "succeeded", campaign_id: "camp1", created_at: "2026-11-27T17:00:00Z",
  buyer: { name: "Sam", email: "sam@x.ca" },
  line_items: [{ rate_title: "Punch card: 10 sessions", quantity: 1,
    answers: [{ question: "Child's Name", answer: "Ada" }, { question: "Child's Birth date", answer: "2021-03-02" }] }],
};
const send = (body: object, token = "t") =>
  POST(new Request(`http://x/api/zeffy/webhook?token=${token}`, { method: "POST", body: JSON.stringify(body) }));

before(async () => {
  for (const c of ["programs", "payments", "passes", "people", "households"]) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
});
beforeEach(async () => {
  for (const c of ["payments", "passes", "people", "households"]) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  const { id, ...program } = GROWING_UP_DENMAN;
  await db.collection("programs").doc(id).set({ ...program, zeffyCampaignId: "camp1" });
});

test("wrong token is rejected", async () => {
  assert.equal((await send({ type: "payment.completed", payment }, "nope")).status, 401);
});

test("a payment creates household, person and pass", async () => {
  assert.equal((await send({ type: "payment.completed", payment })).status, 200);
  const passes = await db.collection("passes").get();
  assert.equal(passes.size, 1);
  assert.equal(passes.docs[0].data().punchesTotal, 10);
  const pay = (await db.collection("payments").doc("pay1").get()).data()!;
  assert.equal(pay.processed, true);
  assert.equal(pay.processingSince, undefined);
});

test("the same payment delivered three times at once makes one pass", async () => {
  const results = await Promise.all([1, 2, 3].map(() => send({ type: "payment.completed", payment })));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal((await db.collection("passes").get()).size, 1);
  assert.equal((await db.collection("people").get()).size, 1);
});

test("a refund event that arrives first keeps the payment flagged", async () => {
  await send({ type: "payment.updated", payment: { id: "pay1" } });
  await send({ type: "payment.completed", payment });
  const pay = (await db.collection("payments").doc("pay1").get()).data()!;
  assert.equal(pay.processed, true);
  assert.equal(pay.needsReview, true);
});
