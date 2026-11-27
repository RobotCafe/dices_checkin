"use client";
import { collection } from "firebase/firestore";
import Link from "next/link";
import { useMemo } from "react";
import { Gate } from "@/gate";
import { db } from "@/lib/firebase";
import type { Headcount, Pass, Person, Program, Visit } from "@/lib/types";
import { useQuery } from "@/lib/useData";

const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function Reports() {
  const programs = useQuery<Program>(collection(db, "programs"), "programs");
  const visits = useQuery<Visit>(collection(db, "visits"), "visits");
  const passes = useQuery<Pass>(collection(db, "passes"), "passes");
  const people = useQuery<Person>(collection(db, "people"), "people");
  const headcounts = useQuery<Headcount>(collection(db, "headcounts"), "headcounts");

  const rows = useMemo(
    () =>
      programs.map((p) => {
        const v = visits.filter((x) => x.programId === p.id && !x.voided);
        const hc = headcounts.filter((x) => x.programId === p.id);
        const dates = new Set([...v.map((x) => x.sessionDate), ...hc.map((x) => x.sessionDate)]);
        const attendances = p.mode === "headcount" ? hc.reduce((n, x) => n + x.count, 0) : v.length;
        return {
          p, sessions: dates.size, attendances,
          people: new Set(v.map((x) => x.personId)).size,
          avg: dates.size ? attendances / dates.size : 0,
          overrides: v.filter((x) => x.override).length,
          passes: passes.filter((x) => x.programId === p.id && x.status === "active").length,
        };
      }),
    [programs, visits, passes, headcounts],
  );

  function exportCsv(p: Program) {
    const name = (id: string) => people.find((x) => x.id === id)?.name ?? "";
    const kind = (id: string | null) => passes.find((x) => x.id === id)?.kind ?? "";
    const lines = [["date", "person", "check_in", "check_out", "pass_kind", "punch_cost", "override_reason", "voided"].join(",")];
    visits.filter((v) => v.programId === p.id).sort((a, b) => a.checkInAt.localeCompare(b.checkInAt)).forEach((v) =>
      lines.push([v.sessionDate, name(v.personId), v.checkInAt, v.checkOutAt ?? "", kind(v.passId), v.punchCost, v.override?.reason ?? "", v.voided ? "yes" : ""].map(csvCell).join(",")),
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = `${p.id}-visits.csv`;
    a.click();
  }

  return (
    <main>
      <div className="bar"><h1>Reports</h1><nav><Link href="/">Check-in</Link><Link href="/admin">Admin</Link></nav></div>
      <p className="meta">Usage per program. Revenue and break-even come next, once the Zeffy payment fields are confirmed.</p>
      {rows.map((r) => (
        <div className="row" key={r.p.id} style={{ display: "block" }}>
          <div className="bar"><strong>{r.p.name}</strong><span className="badge">{r.p.mode}</span></div>
          <div className="meta">
            {r.sessions} sessions · {r.attendances} attendances · avg {r.avg.toFixed(1)} per session
            {r.p.mode === "tracked" && <> · {r.people} different people · {r.passes} active passes · {r.overrides} overrides</>}
          </div>
          {r.p.mode === "tracked" && <button className="secondary" onClick={() => exportCsv(r.p)}>Export visits (CSV)</button>}
        </div>
      ))}
    </main>
  );
}

export default function Page() {
  return <Gate adminOnly><Reports /></Gate>;
}
