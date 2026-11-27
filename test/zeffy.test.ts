import { test } from "node:test";
import assert from "node:assert/strict";
import { birthDateOf, matchPassType, parseDateText, parsePayment } from "../src/lib/zeffy";
import { GROWING_UP_DENMAN as gud, formatPassTypes, parsePassTypes } from "../src/lib/programConfig";

// Payloads follow Zeffy's OpenAPI spec (https://api.zeffy.com/api/docs). Confirm against a real purchase.
const q = (question: string, answer: unknown, type = "text") => ({ question, type, answer });
const ticket = (rate_title: string, questions: object[] = []) =>
  ({ id: "i", object: "item", type: "ticket", amount: 4000, currency: "cad", rate_title, questions });
const zeffyPayment = (o: object = {}) => ({
  id: "p1", object: "payment", created: 1795795200, amount: 4000, currency: "cad", status: "succeeded",
  type: "online", refund_status: "none", refunds: [], dispute: null, campaign_id: "camp1",
  buyer: { email: "Sam@X.ca", first_name: "Sam", last_name: "Lee", is_corporate: false, company_name: null, address: null },
  buyer_questions: [q("Phone", "250-555-0100", "phone")],
  items: [ticket("Punch card: 10 sessions", [q("Child's Name", "Ada", "name"), q("Child's Birth date", "2021-03-02", "date"),
    q("Dietary restrictions", ["Nut-free", "Vegetarian"], "multi_select")])],
  ...o,
});

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

test("parses a payment in Zeffy's documented shape", () => {
  const { payment, tickets } = parsePayment(zeffyPayment(), gud);
  assert.equal(payment.buyerEmail, "sam@x.ca");
  assert.equal(payment.buyerName, "Sam Lee");
  assert.equal(payment.buyerPhone, "250-555-0100");
  assert.equal(payment.purchasedAt, "2026-11-27T16:00:00.000Z"); // from `created`, unix seconds
  assert.equal(payment.source, "online");
  assert.equal(tickets.length, 1);
  assert.deepEqual([tickets[0].name, tickets[0].birthDate, tickets[0].punches], ["Ada", "2021-03-02", 10]);
  assert.deepEqual(tickets[0].dietary, ["Nut-free", "Vegetarian"]);
  assert.deepEqual(payment.warnings, []);
});

test("each ticket is its own item; donations are skipped without a warning", () => {
  const { payment, tickets } = parsePayment(zeffyPayment({
    items: [
      ticket("Drop-in", [q("Child's Name", "Ada"), q("Child's Birth date", "2021-03-02")]),
      ticket("Drop-in", [q("Child's Name", "Bo"), q("Child's Birth date", "2024-06-01")]),
      { id: "d", object: "item", type: "additional_donation", amount: 1000, rate_title: null, questions: [] },
    ],
  }), gud);
  assert.deepEqual(tickets.map((t) => t.name), ["Ada", "Bo"]);
  assert.deepEqual(payment.warnings, []);
});

test("problems are flagged: unknown ticket, missing data, refunds", () => {
  const bad = parsePayment(zeffyPayment({ refund_status: "full", items: [ticket("Mystery"), ticket("Drop-in")] }), gud);
  const w = bad.payment.warnings.join(" | ");
  assert.match(w, /Unrecognized ticket: "Mystery"/);
  assert.match(w, /Missing attendee name/);
  assert.match(w, /Missing birth date/);
  assert.match(w, /full refund/);
});

test("adult program: buyer is the attendee", () => {
  const adult = { ...gud, id: "adult-ed", freeUnderAge: null, questions: { name: "", birth: "", dietary: "" } };
  const { tickets } = parsePayment(zeffyPayment({ items: [ticket("Drop-in")] }), adult);
  assert.equal(tickets[0].name, "Sam Lee");
});

test("free-text birth dates: common formats, ambiguous ones left blank", () => {
  assert.equal(parseDateText("2021-03-02"), "2021-03-02");
  assert.equal(parseDateText("2021/3/2"), "2021-03-02");
  assert.equal(parseDateText("March 2, 2021"), "2021-03-02");
  assert.equal(parseDateText("2 Mar 2021"), "2021-03-02");
  assert.equal(parseDateText("25/03/2021"), "2021-03-25"); // day first, unambiguous
  assert.equal(parseDateText("03/25/2021"), "2021-03-25"); // month first, unambiguous
  assert.equal(parseDateText("03/04/2021"), ""); // could be either: don't guess
  assert.equal(parseDateText("2021-02-30"), ""); // not a real day
  assert.equal(parseDateText("soon"), "");
});

test("birth date from separate day / month / year questions", () => {
  const answers = [
    { question: "Child's Birth date - Day", answer: "2" },
    { question: "Child's Birth date - Month", answer: "March" },
    { question: "Child's Birth date - Year", answer: "2024" },
  ];
  assert.deepEqual(birthDateOf(answers, "birth"), { date: "2024-03-02", raw: "2024/March/2" });
});

test("unreadable birth date is flagged with what was typed", () => {
  const { tickets, payment } = parsePayment(zeffyPayment({
    items: [ticket("Drop-in", [q("Child's Name", "Ada"), q("Child's Birth date", "03/04/2024")])],
  }), gud);
  assert.equal(tickets[0].birthDate, "");
  assert.ok(payment.warnings.some((w) => w.includes('"03/04/2024"')));
});
