import type { PassKind, PassTypeConfig, Program } from "./types";

/**
 * Maps a Zeffy payment object to our records.
 *
 * ASSUMPTION: Zeffy documents that payments carry line items, buyer info and answers to custom
 * questions, but not the exact field names. Several likely names are tried below. VERIFY against
 * the first test purchase (the raw payload is saved in /payments) and tighten this file.
 */

type Obj = Record<string, any>;

export interface ParsedTicket {
  kind: PassKind;
  punches: number | null;
  name: string;
  birthDate: string; // YYYY-MM-DD or ""
  birthRaw: string; // what the buyer typed, for review when it couldn't be read
  dietary: string[];
}

export interface ParsedPayment {
  paymentId: string;
  status: string;
  campaignId: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone?: string;
  purchasedAt: string;
  warnings: string[];
}

export const campaignIdOf = (p: Obj): string =>
  String(p.campaign_id ?? p.campaign?.id ?? p.form_id ?? p.form?.id ?? "");

export function matchPassType(rateLabel: string, types: PassTypeConfig[]): PassTypeConfig | null {
  const l = rateLabel.toLowerCase();
  // longest label first so "Punch card" can't be shadowed by a shorter one
  return [...types].sort((a, b) => b.label.length - a.label.length).find((t) => l.includes(t.label.toLowerCase())) ?? null;
}

function answersMatching(answers: any, needle: string): { q: string; v: string }[] {
  if (!needle) return [];
  const list: Obj[] = Array.isArray(answers) ? answers : [];
  const out: { q: string; v: string }[] = [];
  for (const a of list) {
    const q = String(a.question ?? a.label ?? a.title ?? a.name ?? "").toLowerCase();
    if (q.includes(needle.toLowerCase())) {
      const v = a.answer ?? a.value ?? a.response ?? "";
      out.push({ q, v: Array.isArray(v) ? v.join(", ") : String(v).trim() });
    }
  }
  return out;
}

function answerOf(answers: any, needle: string): string {
  return answersMatching(answers, needle)[0]?.v ?? "";
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthNum = (s: string): number => {
  const t = s.trim().toLowerCase();
  if (/^\d{1,2}$/.test(t)) return Number(t);
  const i = MONTHS.indexOf(t.slice(0, 3));
  return i >= 0 ? i + 1 : NaN;
};
const fullYear = (s: string): number => {
  const n = Number(s.trim());
  return s.trim().length === 2 ? 2000 + n : n;
};

function isoDate(y: number, m: number, d: number): string {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return "";
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return "";
  if (d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** One free-text date. Ambiguous numeric dates (03/04/2021) return "" rather than guess. */
export function parseDateText(raw: string): string {
  const s = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})/))) return isoDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/))) {
    const a = +m[1], b = +m[2], y = fullYear(m[3]);
    if (a > 12) return isoDate(y, b, a); // day first
    if (b > 12) return isoDate(y, a, b); // month first
    return a === b ? isoDate(y, a, b) : "";
  }
  if ((m = s.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i))) return isoDate(+m[3], monthNum(m[1]), +m[2]);
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/i))) return isoDate(+m[3], monthNum(m[2]), +m[1]);
  return "";
}

/**
 * Birth date from either one answer or separate day / month / year answers (each question's label
 * contains the needle plus "day", "month" or "year"). Returns the raw text too, for review warnings.
 */
export function birthDateOf(answers: any, needle: string): { date: string; raw: string } {
  const found = answersMatching(answers, needle).filter((a) => a.v);
  if (found.length === 0) return { date: "", raw: "" };
  const part = (k: string) => found.find((a) => new RegExp(`\\b${k}\\b`).test(a.q))?.v;
  const [d, mo, y] = [part("day"), part("month"), part("year")];
  if (d && mo && y) return { date: isoDate(fullYear(y), monthNum(mo), Number(d)), raw: `${y}/${mo}/${d}` };
  const raw = found.map((a) => a.v).join(" ");
  return { date: parseDateText(found[0].v), raw };
}

export function parsePayment(p: Obj, program: Program): { payment: ParsedPayment; tickets: ParsedTicket[] } {
  const warnings: string[] = [];
  const buyer: Obj = p.buyer ?? p.contact ?? {};
  const buyerName =
    String(buyer.name ?? "") || [buyer.first_name, buyer.last_name].filter(Boolean).join(" ") || answerOf(p.buyer_questions, "full name");
  const items: Obj[] = p.line_items ?? p.lineItems ?? p.items ?? [];
  const tickets: ParsedTicket[] = [];

  for (const it of items) {
    const label = String(it.rate_title ?? it.rate ?? it.title ?? it.name ?? it.description ?? "");
    const type = matchPassType(label, program.passTypes);
    if (!type) {
      if (!/donation|tip/i.test(label)) warnings.push(`Unrecognized line item: "${label}"`);
      continue;
    }
    const answers = it.answers ?? it.questions ?? p.buyer_questions ?? p.answers ?? [];
    const qty = Number(it.quantity ?? 1) || 1;
    for (let i = 0; i < qty; i++) {
      const birth = birthDateOf(answers, program.questions.birth);
      const name = program.questions.name ? answerOf(answers, program.questions.name) : buyerName;
      tickets.push({
        kind: type.kind,
        punches: type.kind === "punch" ? (type.punches ?? 10) : null,
        name,
        birthDate: birth.date,
        birthRaw: birth.raw,
        dietary: answerOf(answers, program.questions.dietary).split(",").map((s) => s.trim()).filter(Boolean),
      });
    }
  }
  if (tickets.length === 0) warnings.push("No ticket line items found");
  for (const t of tickets) {
    if (!t.name) warnings.push("Missing attendee name");
    if (program.freeUnderAge != null && !t.birthDate)
      warnings.push(t.birthRaw ? `Couldn't read birth date "${t.birthRaw}" for "${t.name}"` : `Missing birth date for "${t.name}"`);
  }

  return {
    payment: {
      paymentId: String(p.id ?? ""),
      status: String(p.status ?? ""),
      campaignId: campaignIdOf(p),
      buyerName,
      buyerEmail: String(buyer.email ?? "").toLowerCase(),
      buyerPhone: buyer.phone ? String(buyer.phone) : undefined,
      purchasedAt: String(p.created_at ?? p.createdAt ?? new Date().toISOString()),
      warnings,
    },
    tickets,
  };
}
