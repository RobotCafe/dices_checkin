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

function answerOf(answers: any, needle: string): string {
  if (!needle) return "";
  const list: Obj[] = Array.isArray(answers) ? answers : [];
  for (const a of list) {
    const q = String(a.question ?? a.label ?? a.title ?? a.name ?? "").toLowerCase();
    if (q.includes(needle.toLowerCase())) {
      const v = a.answer ?? a.value ?? a.response ?? "";
      return Array.isArray(v) ? v.join(", ") : String(v);
    }
  }
  return "";
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
      const rawBirth = answerOf(answers, program.questions.birth);
      const name = program.questions.name ? answerOf(answers, program.questions.name) : buyerName;
      tickets.push({
        kind: type.kind,
        punches: type.kind === "punch" ? (type.punches ?? 10) : null,
        name,
        birthDate: /^\d{4}-\d{2}-\d{2}/.test(rawBirth) ? rawBirth.slice(0, 10) : "",
        dietary: answerOf(answers, program.questions.dietary).split(",").map((s) => s.trim()).filter(Boolean),
      });
    }
  }
  if (tickets.length === 0) warnings.push("No ticket line items found");
  for (const t of tickets) {
    if (!t.name) warnings.push("Missing attendee name");
    if (program.freeUnderAge != null && !t.birthDate) warnings.push(`Missing/unparseable birth date for "${t.name}"`);
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
