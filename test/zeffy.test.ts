import { test } from "node:test";
import assert from "node:assert/strict";
import { matchPassType, parsePayment } from "../src/lib/zeffy";
import { GROWING_UP_DENMAN as gud, formatPassTypes, parsePassTypes } from "../src/lib/programConfig";

// NOTE: payload shape is a GUESS until checked against a real Zeffy test purchase.
test("rate labels map to pass types per program", () => {
  assert.equal(matchPassType("Punch card: 10 sessions", gud.passTypes)?.kind, "punch");
  assert.equal(matchPassType("Year Supporter", gud.passTypes)?.kind, "season");
  assert.equal(matchPassType("Pay what you can", gud.passTypes)?.kind, "pwyc");
  assert.equal(matchPassType("Mystery", gud.passTypes), null);
});

test("pass type text round-trips", () => {
  assert.deepEqual(parsePassTypes(formatPassTypes(gud.passTypes)), gud.passTypes);
  assert.throws(() => parsePassTypes("Oops | nonsense"));
});

test("parses a guessed payload and warns on missing data", () => {
  const { payment, tickets } = parsePayment({
    id: "p1", status: "succeeded", campaign_id: "camp1", created_at: "2026-11-27T17:00:00Z",
    buyer: { name: "Sam", email: "Sam@X.ca" },
    line_items: [{ rate_title: "Punch card: 10 sessions", quantity: 1,
      answers: [{ question: "Child's Name", answer: "Ada" }, { question: "Child's Birth date", answer: "2021-03-02" }] }],
  }, gud);
  assert.equal(payment.buyerEmail, "sam@x.ca");
  assert.equal(tickets[0].name, "Ada");
  assert.equal(tickets[0].punches, 10);
  assert.equal(payment.warnings.length, 0);

  const bad = parsePayment({ id: "p2", line_items: [{ rate_title: "Drop-in", answers: [] }] }, gud);
  assert.ok(bad.payment.warnings.length >= 2);
});

test("adult program: buyer is the attendee", () => {
  const adult = { ...gud, id: "adult-ed", freeUnderAge: null, questions: { name: "", birth: "", dietary: "" } };
  const { tickets } = parsePayment({ id: "p3", buyer: { name: "Pat", email: "p@x.ca" }, line_items: [{ rate_title: "Drop-in" }] }, adult);
  assert.equal(tickets[0].name, "Pat");
});
