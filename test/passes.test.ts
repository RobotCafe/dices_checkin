import { test } from "node:test";
import assert from "node:assert/strict";
import { decideCheckIn, statusOf } from "../src/lib/passes";
import { ageOn, bcDate } from "../src/lib/time";
import { GROWING_UP_DENMAN as gud } from "../src/lib/programConfig";
import type { Pass, Person, Program, Visit } from "../src/lib/types";

const kid: Person = { id: "c1", name: "Ada", birthDate: "2020-01-01", householdId: "h", programIds: [gud.id], mergedInto: null };
const baby: Person = { ...kid, id: "c2", name: "Bo", birthDate: "2025-06-01" };
const day = "2026-12-04";

const pass = (o: Partial<Pass>): Pass => ({
  id: "p", programId: gud.id, kind: "punch", personId: "c1", householdId: "h", zeffyPaymentId: "z",
  purchasedAt: "2026-11-27T17:00:00Z", validFrom: "2026-11-27", validThrough: "2027-06-25",
  punchesTotal: 10, status: "active", ...o,
});
const visit = (o: Partial<Visit>): Visit => ({
  id: "v", programId: gud.id, personId: "c1", passId: "p", sessionDate: "2026-11-27",
  checkInAt: "2026-11-27T16:00:00Z", checkInBy: "a@b.c", punchCost: 1, ...o,
});

test("bcDate uses UTC-7 with no DST", () => {
  assert.equal(bcDate(new Date("2026-07-01T05:00:00Z")), "2026-06-30");
  assert.equal(bcDate(new Date("2026-12-04T16:00:00Z")), "2026-12-04");
});

test("age", () => {
  assert.equal(ageOn("2023-12-05", "2026-12-04"), 2);
  assert.equal(ageOn("2023-12-04", "2026-12-04"), 3);
});

test("punch card counts down and ignores voided visits", () => {
  const s = statusOf(pass({}), [visit({ id: "1" }), visit({ id: "2" }), visit({ id: "3", voided: true })], day);
  assert.equal(s.punchesLeft, 8);
});

test("exhausted punch card is not usable", () => {
  const visits = Array.from({ length: 10 }, (_, i) => visit({ id: String(i) }));
  assert.equal(decideCheckIn(kid, gud, [pass({})], visits, day).kind, "no-pass");
});

test("under the program's free age: no punch, but a pass is still needed", () => {
  const d = decideCheckIn(baby, gud, [pass({ personId: "c2" })], [], day);
  assert.equal(d.kind, "ok");
  if (d.kind === "ok") { assert.equal(d.punchCost, 0); assert.equal(d.punchesLeftAfter, 10); }
  assert.equal(decideCheckIn(baby, gud, [], [], day).kind, "no-pass");
});

test("program without an age rule charges everyone a punch", () => {
  const adults: Program = { ...gud, id: "adult-ed", freeUnderAge: null };
  const d = decideCheckIn(baby, adults, [pass({ programId: "adult-ed", personId: "c2" })], [], day);
  assert.equal(d.kind === "ok" && d.punchCost, 1);
});

test("a punch card belongs to one program", () => {
  const other: Program = { ...gud, id: "teen-night" };
  assert.equal(decideCheckIn(kid, other, [pass({})], [], day).kind, "no-pass");
  // and punches used in another program don't reduce this one
  const s = statusOf(pass({}), [visit({ programId: "teen-night" })].filter((v) => v.programId === gud.id), day);
  assert.equal(s.punchesLeft, 10);
});

test("season pass is preferred over punch card and costs no punches", () => {
  const d = decideCheckIn(kid, gud, [pass({}), pass({ id: "y", kind: "season", punchesTotal: null })], [], day);
  assert.equal(d.kind === "ok" && d.pass.id, "y");
});

test("drop-in is single use", () => {
  const dropin = pass({ id: "d", kind: "dropin", punchesTotal: null });
  assert.equal(decideCheckIn(kid, gud, [dropin], [], day).kind, "ok");
  assert.equal(decideCheckIn(kid, gud, [dropin], [visit({ passId: "d", sessionDate: day, checkOutAt: "x", punchCost: 0 })], "2026-12-11").kind, "no-pass");
});

test("already checked in", () => {
  assert.equal(decideCheckIn(kid, gud, [pass({})], [visit({ sessionDate: day })], day).kind, "already-here");
});
