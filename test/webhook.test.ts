// Zeffy webhook against the Firestore emulator: npm run test:rules (runs all emulator tests).
import { afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { adminDb } from "../src/lib/admin";
import { GROWING_UP_DENMAN } from "../src/lib/programConfig";
import { signLikeZeffy } from "../src/lib/webhookSignature";
import { POST } from "../src/app/api/zeffy/webhook/route";

process.env.ZEFFY_WEBHOOK_TOKEN = "t";
process.env.ZEFFY_WEBHOOK_SECRET = "whsec_test";
process.env.ZEFFY_API_KEY = "zeffy_test";
const db = adminDb();
const realFetch = globalThis.fetch;

// Shape from Zeffy's OpenAPI spec (PaymentCompletedEvent / Payment).
const payment = {
  id: "pay1", object: "payment", created: 1795795200, amount: 4000, currency: "cad", status: "succeeded",
  type: "online", refund_status: "none", refunds: [], dispute: null, campaign_id: "camp1",
  buyer: { email: "sam@x.ca", first_name: "Sam", last_name: "Lee", is_corporate: false, company_name: null, address: null },
  buyer_questions: [],
  items: [{ id: "i1", object: "item", type: "ticket", amount: 4000, currency: "cad", rate_title: "Punch card: 10 sessions",
    questions: [{ question: "Child's Name", type: "text", answer: "Ada" }, { question: "Child's Birth date", type: "date", answer: "2021-03-02" }] }],
};
const event = (type: string, data: object) => ({ id: `evt_${type}`, type, version: 1, dispatchedAt: "2026-11-27T16:00:00Z", data });

function send(body: object, opts: { token?: string; signature?: string | null } = {}) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = opts.signature === undefined ? signLikeZeffy(raw, "whsec_test") : opts.signature;
  if (sig) headers["zeffy-signature"] = sig;
  return POST(new Request(`http://x/api/zeffy/webhook?token=${opts.token ?? "t"}`, { method: "POST", headers, body: raw }));
}

async function clear(cols: string[]) {
  for (const c of cols) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}
before(() => clear(["programs"]));
beforeEach(async () => {
  await clear(["payments", "passes", "people", "households", "webhookEvents"]);
  const { id, ...program } = GROWING_UP_DENMAN;
  await db.collection("programs").doc(id).set({ ...program, zeffyCampaignId: "camp1" });
});
afterEach(() => { globalThis.fetch = realFetch; });

test("wrong token, missing or forged signature are rejected", async () => {
  const body = event("payment.completed", payment);
  assert.equal((await send(body, { token: "nope" })).status, 401);
  assert.equal((await send(body, { signature: null })).status, 400);
  assert.equal((await send(body, { signature: signLikeZeffy("{}", "whsec_test") })).status, 400);
  assert.equal((await send(body, { signature: signLikeZeffy(JSON.stringify(body), "whsec_wrong") })).status, 400);
  assert.equal((await db.collection("passes").get()).size, 0);
});

test("a payment creates household, person and pass", async () => {
  assert.equal((await send(event("payment.completed", payment))).status, 200);
  const passes = await db.collection("passes").get();
  assert.equal(passes.size, 1);
  assert.equal(passes.docs[0].data().punchesTotal, 10);
  assert.equal(passes.docs[0].data().purchasedAt, "2026-11-27T16:00:00.000Z");
  const person = (await db.collection("people").get()).docs[0].data();
  assert.deepEqual([person.name, person.birthDate], ["Ada", "2021-03-02"]);
  const pay = (await db.collection("payments").doc("pay1").get()).data()!;
  assert.equal(pay.processed, true);
  assert.equal(pay.needsReview, false);
  assert.equal(pay.processingSince, undefined);
});

test("the same payment delivered three times at once makes one pass", async () => {
  const results = await Promise.all([1, 2, 3].map(() => send(event("payment.completed", payment))));
  assert.ok(results.every((r) => r.status === 200));
  assert.equal((await db.collection("passes").get()).size, 1);
  assert.equal((await db.collection("people").get()).size, 1);
});

test("payment.updated fetches the payment and flags a refund for review", async () => {
  await send(event("payment.completed", payment));
  let asked = "";
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    asked = `${url} ${(init?.headers as Record<string, string>).Authorization}`;
    return new Response(JSON.stringify({ ...payment, refund_status: "full" }), { status: 200 });
  }) as typeof fetch;
  assert.equal((await send(event("payment.updated", { id: "pay1", object: "payment" }))).status, 200);
  assert.equal(asked, "https://api.zeffy.com/api/v1/payments/pay1 Bearer zeffy_test");
  const pay = (await db.collection("payments").doc("pay1").get()).data()!;
  assert.equal(pay.needsReview, true);
  assert.equal(pay.refundStatus, "full");
  assert.equal(pay.reviewReason, "Refund: full");
});

test("payment.updated with no refund or dispute doesn't flag", async () => {
  await send(event("payment.completed", payment));
  globalThis.fetch = (async () => new Response(JSON.stringify(payment), { status: 200 })) as typeof fetch;
  await send(event("payment.updated", { id: "pay1", object: "payment" }));
  assert.equal((await db.collection("payments").doc("pay1").get()).data()!.needsReview, false);
});

test("if Zeffy's API fails, the update returns an error so Zeffy retries", async () => {
  globalThis.fetch = (async () => new Response("boom", { status: 503 })) as typeof fetch;
  await assert.rejects(send(event("payment.updated", { id: "pay1", object: "payment" })));
});

test("a refund that arrives before the payment keeps it flagged", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ ...payment, refund_status: "full" }), { status: 200 })) as typeof fetch;
  await send(event("payment.updated", { id: "pay1", object: "payment" }));
  await send(event("payment.completed", payment));
  const pay = (await db.collection("payments").doc("pay1").get()).data()!;
  assert.equal(pay.processed, true);
  assert.equal(pay.needsReview, true);
});

test("events the app doesn't act on are kept for review", async () => {
  assert.equal((await send(event("contact.created", { id: "c1" }))).status, 200);
  assert.equal((await db.collection("webhookEvents").get()).size, 1);
});
