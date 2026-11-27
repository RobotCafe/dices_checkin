// Usage: npm run seed-admin -- you@example.com   (reads .env.local)
import { adminDb } from "../src/lib/admin";
import { GROWING_UP_DENMAN } from "../src/lib/programConfig";

const email = process.argv[2]?.toLowerCase();
if (!email) throw new Error("usage: npm run seed-admin -- email@example.com");
const db = adminDb();
(async () => {
  await db.collection("staff").doc(email).set({ email, role: "admin" });
  const { id, ...program } = GROWING_UP_DENMAN;
  const ref = db.collection("programs").doc(id);
  if (!(await ref.get()).exists) await ref.set(program); // example program; edit in Admin > Programs
  console.log(`admin created: ${email}; example program "${program.name}" ready`);
})();
