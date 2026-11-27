"use client";
import { addDoc, arrayUnion, collection, collection as col, deleteDoc, doc, getDocs, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import Link from "next/link";
import { useState } from "react";
import { Gate } from "@/gate";
import { db } from "@/lib/firebase";
import { formatPassTypes, parsePassTypes, slug } from "@/lib/programConfig";
import type { Household, Person, Program, StaffMember } from "@/lib/types";
import { useQuery, useSession } from "@/lib/useData";

const blank = {
  id: "", name: "", mode: "tracked" as Program["mode"], zeffyCampaignId: "", seasonStart: "", seasonEnd: "",
  freeUnderAge: "", passTypes: "Drop-in | dropin\nPunch card | punch | 10\nYear Supporter | season",
  qName: "child's name", qBirth: "birth", qDietary: "dietary",
};

function Admin() {
  const s = useSession();
  const staff = useQuery<StaffMember & { id: string }>(col(db, "staff"), "staff");
  const programs = useQuery<Program>(col(db, "programs"), "programs");
  const people = useQuery<Person>(query(col(db, "people"), where("mergedInto", "==", null)), "people");
  const households = useQuery<Household>(query(col(db, "households"), where("mergedInto", "==", null)), "households");
  const review = useQuery<{ id: string; warnings?: string[] }>(query(col(db, "payments"), where("needsReview", "==", true)), "review");

  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [keep, setKeep] = useState("");
  const [drop, setDrop] = useState("");
  const [msg, setMsg] = useState("");
  const [f, setF] = useState(blank);
  const [err, setErr] = useState("");
  if (s.state !== "in") return null;
  const me = s.user.email!.toLowerCase();

  async function invite() {
    const e = email.trim().toLowerCase();
    if (!e.includes("@")) return;
    await setDoc(doc(db, "staff", e), { email: e, role: "staff", programIds: scope.length ? scope : null, invitedBy: me });
    setEmail(""); setScope([]);
  }

  const label = (id: string) => {
    const p = people.find((x) => x.id === id);
    const h = households.find((x) => x.id === p?.householdId);
    return p ? `${p.name} (b. ${p.birthDate || "?"}) · ${h?.contactName ?? ""}` : id;
  };

  async function merge() {
    if (!keep || !drop || keep === drop) return;
    if (!window.confirm(`Merge\n  ${label(drop)}\ninto\n  ${label(keep)}?`)) return;
    const dropPerson = people.find((p) => p.id === drop)!;
    const batch = writeBatch(db);
    for (const c of ["passes", "visits"]) {
      const snap = await getDocs(query(collection(db, c), where("personId", "==", drop)));
      snap.docs.forEach((d) => batch.update(d.ref, { personId: keep }));
    }
    batch.update(doc(db, "people", keep), { programIds: arrayUnion(...dropPerson.programIds) });
    batch.update(doc(db, "people", drop), { mergedInto: keep });
    await batch.commit();
    await addDoc(collection(db, "audit"), { at: new Date().toISOString(), by: me, action: "merge-person", keep, drop });
    setMsg("Merged."); setKeep(""); setDrop("");
  }

  function edit(p: Program) {
    setF({
      id: p.id, name: p.name, mode: p.mode, zeffyCampaignId: p.zeffyCampaignId ?? "", seasonStart: p.seasonStart,
      seasonEnd: p.seasonEnd, freeUnderAge: p.freeUnderAge == null ? "" : String(p.freeUnderAge),
      passTypes: formatPassTypes(p.passTypes), qName: p.questions.name, qBirth: p.questions.birth, qDietary: p.questions.dietary,
    });
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  async function saveProgram() {
    setErr("");
    try {
      if (!f.name.trim()) throw new Error("Name is required");
      const program: Omit<Program, "id"> = {
        name: f.name.trim(), mode: f.mode, zeffyCampaignId: f.zeffyCampaignId.trim() || null,
        seasonStart: f.seasonStart, seasonEnd: f.seasonEnd,
        freeUnderAge: f.freeUnderAge === "" ? null : Number(f.freeUnderAge),
        passTypes: f.mode === "headcount" ? [] : parsePassTypes(f.passTypes),
        questions: { name: f.qName.trim(), birth: f.qBirth.trim(), dietary: f.qDietary.trim() },
      };
      await setDoc(doc(db, "programs", f.id || slug(f.name)), program, { merge: true });
      setF(blank);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const options = [...people].sort((a, b) => a.name.localeCompare(b.name));
  const sel = { width: "100%", margin: "4px 0" } as const;
  const field = (k: keyof typeof blank, ph: string, type = "text") => (
    <input style={{ margin: "4px 0" }} placeholder={ph} type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
  );

  return (
    <main>
      <div className="bar"><h1>Admin</h1><nav><Link href="/">Check-in</Link><Link href="/reports">Reports</Link></nav></div>

      <h2>Staff</h2>
      {staff.map((m) => (
        <div className="row" key={m.email}>
          <span>
            {m.email} <span className="badge">{m.role}</span>{" "}
            {m.role !== "admin" && <span className="meta">{m.programIds?.length ? m.programIds.join(", ") : "all programs"}</span>}
          </span>
          {m.role !== "admin" && <button className="secondary" onClick={() => deleteDoc(doc(db, "staff", m.email))}>Remove</button>}
        </div>
      ))}
      <div className="row" style={{ display: "block" }}>
        <input placeholder="Invite by Google email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <p className="meta">Limit to programs (none ticked = all):</p>
        {programs.map((p) => (
          <label key={p.id} style={{ marginRight: 14 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={scope.includes(p.id)}
              onChange={(e) => setScope(e.target.checked ? [...scope, p.id] : scope.filter((x) => x !== p.id))} /> {p.name}
          </label>
        ))}
        <div><button onClick={invite}>Invite</button></div>
      </div>

      <h2>Programs</h2>
      {programs.map((p) => (
        <div className="row" key={p.id}>
          <div>{p.name} <span className="badge">{p.mode}</span>
            <div className="meta">{p.zeffyCampaignId ? `Zeffy campaign ${p.zeffyCampaignId}` : "no Zeffy campaign linked"}</div></div>
          <div>
            <button className="secondary" onClick={() => edit(p)}>Edit</button>{" "}
            <button className="secondary" onClick={() => updateDoc(doc(db, "programs", p.id), { archived: !p.archived })}>{p.archived ? "Unarchive" : "Archive"}</button>
          </div>
        </div>
      ))}

      <h2>{f.id ? `Edit ${f.name}` : "Add a program"}</h2>
      {field("name", "Program name")}
      <select style={sel} value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as Program["mode"] })}>
        <option value="tracked">Tracked: named people, passes, check-in/out</option>
        <option value="headcount">Headcount only: no names stored</option>
      </select>
      {field("zeffyCampaignId", "Zeffy campaign id (from the campaign's payments)")}
      {field("seasonStart", "Season start", "date")}
      {field("seasonEnd", "Season end", "date")}
      {f.mode === "tracked" && <>
        {field("freeUnderAge", "Free under age (blank = everyone uses a punch)", "number")}
        <p className="meta">Pass types, one per line: Label | dropin / punch / season / pwyc | punches. The label must appear in the Zeffy rate name.</p>
        <textarea style={{ width: "100%", minHeight: 90, padding: 10 }} value={f.passTypes} onChange={(e) => setF({ ...f, passTypes: e.target.value })} />
        <p className="meta">Text that identifies the Zeffy questions (leave the name blank if the buyer is the attendee):</p>
        {field("qName", "Attendee name question contains…")}
        {field("qBirth", "Birth date question contains…")}
        {field("qDietary", "Dietary question contains…")}
      </>}
      {err && <p style={{ color: "#a33a2c" }}>{err}</p>}
      <button onClick={saveProgram}>Save program</button>{f.id && <> <button className="secondary" onClick={() => setF(blank)}>Cancel</button></>}

      <h2>Merge duplicate people</h2>
      <select value={drop} onChange={(e) => setDrop(e.target.value)} style={sel}>
        <option value="">Duplicate to remove…</option>
        {options.map((p) => <option key={p.id} value={p.id}>{label(p.id)}</option>)}
      </select>
      <select value={keep} onChange={(e) => setKeep(e.target.value)} style={sel}>
        <option value="">Record to keep…</option>
        {options.map((p) => <option key={p.id} value={p.id}>{label(p.id)}</option>)}
      </select>
      <button onClick={merge} disabled={!keep || !drop || keep === drop}>Merge</button>
      {msg && <span className="meta"> {msg}</span>}

      <h2>Payments needing review ({review.length})</h2>
      <p className="meta">Imported with a missing field or no matching program, or refunded/changed in Zeffy. Check them in the Zeffy dashboard.</p>
      {review.map((r) => (
        <div className="row" key={r.id}><div>{r.id}<div className="meta">{r.warnings?.join("; ") || "Updated in Zeffy"}</div></div></div>
      ))}
    </main>
  );
}

export default function Page() {
  return <Gate adminOnly><Admin /></Gate>;
}
