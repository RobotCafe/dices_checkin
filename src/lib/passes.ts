import { ageOn } from "./time";
import type { Pass, Person, Program, Visit } from "./types";

export interface PassStatus {
  pass: Pass;
  punchesUsed: number;
  punchesLeft: number | null; // null when not a punch card
  usable: boolean;
  reason?: string;
}

/** Punches this person uses per visit in this program (0 if under the program's free age). */
export function punchCostFor(person: Person, program: Program, sessionDate: string): number {
  if (program.freeUnderAge == null || !person.birthDate) return 1;
  return ageOn(person.birthDate, sessionDate) < program.freeUnderAge ? 0 : 1;
}

export function statusOf(pass: Pass, visits: Visit[], sessionDate: string): PassStatus {
  const mine = visits.filter((v) => v.passId === pass.id && !v.voided);
  const used = mine.reduce((n, v) => n + v.punchCost, 0);
  const left = pass.kind === "punch" ? (pass.punchesTotal ?? 0) - used : null;

  let usable = pass.status === "active";
  let reason: string | undefined = usable ? undefined : "Pass voided";
  if (usable && (sessionDate < pass.validFrom || sessionDate > pass.validThrough)) {
    usable = false;
    reason = "Outside valid dates";
  }
  if (usable && pass.kind === "punch" && (left ?? 0) <= 0) {
    usable = false;
    reason = "No punches left";
  }
  if (usable && (pass.kind === "dropin" || pass.kind === "pwyc") && mine.length > 0) {
    usable = false;
    reason = "Already used";
  }
  return { pass, punchesUsed: used, punchesLeft: left, usable, reason };
}

const PRIORITY: Record<Pass["kind"], number> = { season: 0, punch: 1, dropin: 2, pwyc: 3 };

export type CheckInDecision =
  | { kind: "already-here"; visit: Visit }
  | { kind: "ok"; pass: Pass; punchCost: number; punchesLeftAfter: number | null }
  | { kind: "no-pass"; blocked: PassStatus[] };

/**
 * Only this program's passes and visits are considered: a punch card belongs to one program.
 * Best usable pass: season, then punch card, then drop-in, then pay-what-you-can.
 */
export function decideCheckIn(
  person: Person,
  program: Program,
  passes: Pass[],
  visits: Visit[],
  sessionDate: string,
): CheckInDecision {
  const pVisits = visits.filter((v) => v.programId === program.id);
  const here = pVisits.find((v) => v.personId === person.id && v.sessionDate === sessionDate && !v.voided && !v.checkOutAt);
  if (here) return { kind: "already-here", visit: here };

  const statuses = passes
    .filter((p) => p.programId === program.id && p.personId === person.id)
    .map((p) => statusOf(p, pVisits, sessionDate));
  const usable = statuses.filter((s) => s.usable).sort((a, b) => PRIORITY[a.pass.kind] - PRIORITY[b.pass.kind]);
  if (usable.length === 0) return { kind: "no-pass", blocked: statuses };

  const best = usable[0];
  const cost = best.pass.kind === "punch" ? punchCostFor(person, program, sessionDate) : 0;
  return {
    kind: "ok",
    pass: best.pass,
    punchCost: cost,
    punchesLeftAfter: best.punchesLeft === null ? null : best.punchesLeft - cost,
  };
}
