"use client";
import { addDoc, collection, doc, setDoc, updateDoc } from "firebase/firestore";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Gate } from "@/gate";
import { db } from "@/lib/firebase";
import { decideCheckIn } from "@/lib/passes";
import { bcDate } from "@/lib/time";
import type { Person, Program, Visit } from "@/lib/types";
import { logOut, useProgramData, usePrograms, useSession } from "@/lib/useData";

function Headcount({ program, me }: { program: Program; me: string }) {
  const { headcounts } = useProgramData(program.id);
  const today = bcDate(new Date());
  const id = `${program.id}_${today}`;
  const count = headcounts.find((h) => h.id === id)?.count ?? 0;
  const set = (n: number) =>
    setDoc(doc(db, "headcounts", id), {
      programId: program.id, sessionDate: today, count: Math.max(0, n),
      updatedAt: new Date().toISOString(), updatedBy: me,
    });
  return (
    <div style={{ textAlign: "center" }}>
      <p className="meta">No names are recorded for this program. Today: {today}</p>
      <div style={{ fontSize: "5rem", fontWeight: 700 }}>{count}</div>
      <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
        <button className="secondary" style={{ minWidth: 100 }} onClick={() => set(count - 1)}>−1</button>
        <button style={{ minWidth: 160, fontSize: "1.4rem" }} onClick={() => set(count + 1)}>+1</button>
      </div>
    </div>
  );
}

function Tracked({ program, me }: { program: Program; me: string }) {
  const { people, households, passes, visits } = useProgramData(program.id);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const today = bcDate(new Date());

  const contact = (id: string) => households.find((h) => h.id === id)?.contactName ?? "";
  const personName = (id: string) => people.find((p) => p.id === id)?.name ?? "(merged)";
  const here = visits.filter((v) => v.sessionDate === today && !v.voided && !v.checkOutAt);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return people.filter((p) => p.name.toLowerCase().includes(t) || contact(p.householdId).toLowerCase().includes(t)).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, people, households]);

  async function checkIn(person: Person) {
    const d = decideCheckIn(person, program, passes, visits, today);
    if (d.kind === "already-here") return setMsg(`${person.name} is already checked in`);
    const base = { programId: program.id, personId: person.id, sessionDate: today, checkInAt: new Date().toISOString(), checkInBy: me };
    if (d.kind === "ok") {
      await addDoc(collection(db, "visits"), { ...base, passId: d.pass.id, punchCost: d.punchCost });
      setMsg(d.punchesLeftAfter === null ? `${person.name} checked in` : `${person.name} checked in, ${d.punchesLeftAfter} punches left`);
    } else {
      const why = d.blocked.map((b) => b.reason).join(", ") || "No pass on file";
      const reason = window.prompt(`${person.name}: no valid pass (${why}).\nOverride? Enter a reason, or cancel.`);
      if (!reason) return;
      await addDoc(collection(db, "visits"), { ...base, passId: null, punchCost: 0, override: { reason } });
      setMsg(`${person.name} checked in by override, flagged for follow-up`);
    }
    setQ("");
  }

  const checkOut = (v: Visit, auto = false) =>
    updateDoc(doc(db, "visits", v.id), { checkOutAt: new Date().toISOString(), checkOutBy: me, ...(auto ? { checkOutAuto: true } : {}) });

  function badge(p: Person) {
    const d = decideCheckIn(p, program, passes, visits, today);
    if (d.kind === "already-here") return <span className="badge ok">here</span>;
    if (d.kind === "no-pass") return <span className="badge warn">no valid pass</span>;
    const left = d.punchesLeftAfter === null ? null : d.punchesLeftAfter + d.punchCost;
    return <span className="badge ok">{d.pass.kind === "punch" ? `${left} punches left` : d.pass.kind}</span>;
  }

  return (
    <>
      <input placeholder="Search name or contact…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {msg && <p className="meta">{msg}</p>}
      {matches.map((p) => (
        <div className="row" key={p.id}>
          <div>
            <strong>{p.name}</strong> {badge(p)}
            <div className="meta">{contact(p.householdId)}{p.dietary?.length ? ` · ${p.dietary.join(", ")}` : ""}</div>
          </div>
          <button onClick={() => checkIn(p)}>Check in</button>
        </div>
      ))}

      <h2>Here now ({here.length})</h2>
      {here.map((v) => (
        <div className="row" key={v.id}>
          <div>
            {personName(v.personId)}{v.override && <span className="badge warn"> override</span>}
            <div className="meta">in {new Date(v.checkInAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
          </div>
          <button className="secondary" onClick={() => checkOut(v)}>Check out</button>
        </div>
      ))}
      {here.length > 0 && (
        <button className="danger" onClick={() => window.confirm(`Check out everyone (${here.length}) still here?`) && here.forEach((v) => checkOut(v, true))}>
          Close session
        </button>
      )}
    </>
  );
}

function CheckIn() {
  const s = useSession();
  const programs = usePrograms();
  const [programId, setProgramId] = useState<string>("");

  // The tablet remembers its program.
  useEffect(() => {
    const saved = localStorage.getItem("programId") ?? "";
    setProgramId(saved);
  }, []);
  const program = programs.find((p) => p.id === programId) ?? null;
  if (s.state !== "in") return null;
  const me = s.user.email!.toLowerCase();

  return (
    <main>
      <div className="bar">
        <h1>Check-in</h1>
        <nav>
          {s.staff.role === "admin" && <><Link href="/reports">Reports</Link><Link href="/admin">Admin</Link></>}
          <a href="#" onClick={logOut}>Sign out</a>
        </nav>
      </div>
      <select
        value={programId}
        onChange={(e) => { setProgramId(e.target.value); localStorage.setItem("programId", e.target.value); }}
        style={{ width: "100%", marginBottom: 12 }}
      >
        <option value="">Choose a program…</option>
        {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {!program && programs.length === 0 && <p className="meta">No programs available to you yet.</p>}
      {program?.mode === "headcount" && <Headcount program={program} me={me} />}
      {program?.mode === "tracked" && <Tracked key={program.id} program={program} me={me} />}
    </main>
  );
}

export default function Page() {
  return <Gate><CheckIn /></Gate>;
}
