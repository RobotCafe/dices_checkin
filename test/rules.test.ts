// Firestore security rules, run against the emulator: npm run test:rules (needs Java).
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, increment, query, setDoc, updateDoc, where } from "firebase/firestore";

let env: RulesTestEnvironment;

const ADMIN = "admin@dices.ca";
const LEAD = "lead@dices.ca"; // program lead for Growing Up Denman only
const STAFF = "staff@dices.ca"; // staff with no program limit
const STRANGER = "someone@gmail.com";

const as = (email: string, verified = true) =>
  env.authenticatedContext(email, { email, email_verified: verified }).firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-dices-checkin",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8287 },
  });
});
after(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "staff", ADMIN), { email: ADMIN, role: "admin" });
    await setDoc(doc(db, "staff", LEAD), { email: LEAD, role: "staff", programIds: ["gud"] });
    await setDoc(doc(db, "staff", STAFF), { email: STAFF, role: "staff", programIds: null });
    await setDoc(doc(db, "people", "ada"), { name: "Ada", programIds: ["gud"], mergedInto: null, householdId: "h1", birthDate: "" });
    await setDoc(doc(db, "people", "pat"), { name: "Pat", programIds: ["soccer"], mergedInto: null, householdId: "h2", birthDate: "" });
    await setDoc(doc(db, "households", "h1"), { contactName: "Sam", email: "s@x.ca", programIds: ["gud"], mergedInto: null });
    await setDoc(doc(db, "visits", "v1"), {
      programId: "gud", personId: "ada", passId: "p1", sessionDate: "2026-12-04",
      checkInAt: "2026-12-04T16:00:00Z", checkInBy: LEAD, punchCost: 1,
    });
    await setDoc(doc(db, "payments", "z1"), { raw: {}, needsReview: true });
  });
});

const peopleIn = (db: ReturnType<typeof as>, pid: string) =>
  query(collection(db, "people"), where("programIds", "array-contains", pid), where("mergedInto", "==", null));

test("strangers and unverified emails get nothing", async () => {
  await assertFails(getDoc(doc(as(STRANGER), "people", "ada")));
  await assertFails(getDoc(doc(as(LEAD, false), "people", "ada")));
});

test("program lead: the check-in screen's queries work for their program", async () => {
  const db = as(LEAD);
  await assertSucceeds(getDocs(peopleIn(db, "gud")));
  await assertSucceeds(getDocs(query(collection(db, "households"), where("programIds", "array-contains", "gud"), where("mergedInto", "==", null))));
  await assertSucceeds(getDocs(query(collection(db, "visits"), where("programId", "==", "gud"))));
  await assertSucceeds(getDoc(doc(db, "people", "ada")));
});

test("program lead: other programs are off limits", async () => {
  const db = as(LEAD);
  await assertFails(getDocs(peopleIn(db, "soccer")));
  await assertFails(getDoc(doc(db, "people", "pat")));
  await assertFails(getDocs(query(collection(db, "visits"), where("programId", "==", "soccer"))));
});

test("staff without a program limit and the admin see every program", async () => {
  await assertSucceeds(getDocs(peopleIn(as(STAFF), "soccer")));
  await assertSucceeds(getDocs(peopleIn(as(ADMIN), "soccer")));
});

test("visits: check in as yourself only", async () => {
  const db = as(LEAD);
  const base = { programId: "gud", personId: "ada", passId: "p1", sessionDate: "2026-12-11", checkInAt: "x", punchCost: 1 };
  await assertSucceeds(setDoc(doc(db, "visits", "v2"), { ...base, checkInBy: LEAD }));
  await assertFails(setDoc(doc(db, "visits", "v3"), { ...base, checkInBy: STAFF }));
});

test("visits: check-out changes only check-out fields, and only once", async () => {
  const db = as(LEAD);
  await assertFails(updateDoc(doc(db, "visits", "v1"), { punchCost: 0 }));
  await assertSucceeds(updateDoc(doc(db, "visits", "v1"), { checkOutAt: "2026-12-04T18:00:00Z", checkOutBy: LEAD }));
  await assertFails(updateDoc(doc(db, "visits", "v1"), { checkOutAt: "2026-12-04T23:00:00Z", checkOutBy: LEAD }));
});

test("visits: only the admin voids", async () => {
  await assertFails(updateDoc(doc(as(LEAD), "visits", "v1"), { voided: true, voidedBy: LEAD, voidReason: "oops" }));
  await assertSucceeds(updateDoc(doc(as(ADMIN), "visits", "v1"), { voided: true, voidedBy: ADMIN, voidReason: "oops" }));
});

test("headcounts: increments work, no negatives, no extra (personal) fields", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "programs", "foodbank"), { name: "Food bank" });
  });
  const db = as(STAFF);
  const ref = doc(db, "headcounts", "foodbank_2026-12-04");
  const base = { programId: "foodbank", sessionDate: "2026-12-04", updatedAt: "x", updatedBy: STAFF };
  await assertSucceeds(setDoc(ref, { ...base, count: increment(1) }, { merge: true }));
  await assertSucceeds(setDoc(ref, { ...base, count: increment(1) }, { merge: true }));
  await assertSucceeds(setDoc(ref, { ...base, count: increment(-1) }, { merge: true }));
  await assertSucceeds(setDoc(ref, { ...base, count: increment(-1) }, { merge: true }));
  await assertFails(setDoc(ref, { ...base, count: increment(-1) }, { merge: true }));
  await assertFails(setDoc(ref, { ...base, count: increment(1), name: "Jane Doe" }, { merge: true }));
  await assertFails(setDoc(doc(db, "headcounts", "wrong-id"), { ...base, count: 1 }));
});

test("payments: admin only", async () => {
  await assertFails(getDoc(doc(as(LEAD), "payments", "z1")));
  await assertFails(getDoc(doc(as(STAFF), "payments", "z1")));
  await assertSucceeds(getDoc(doc(as(ADMIN), "payments", "z1")));
});
