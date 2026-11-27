export type PassKind = "dropin" | "punch" | "season" | "pwyc";

export interface PassTypeConfig {
  label: string; // also the text matched (case-insensitive substring) against the Zeffy rate name
  kind: PassKind;
  punches?: number; // punch cards only
}

export interface Program {
  id: string;
  name: string;
  /** tracked = named people, passes, check-in/out. headcount = anonymous counts only (no names stored). */
  mode: "tracked" | "headcount";
  zeffyCampaignId: string | null;
  seasonStart: string; // YYYY-MM-DD
  seasonEnd: string;
  /** People younger than this don't use a punch. null = everyone uses one. */
  freeUnderAge: number | null;
  passTypes: PassTypeConfig[];
  /** Substrings that identify each Zeffy per-ticket question. Empty name = the buyer is the attendee. */
  questions: { name: string; birth: string; dietary: string };
  archived?: boolean;
}

export interface Household {
  id: string;
  contactName: string;
  email: string;
  phone?: string | null;
  programIds: string[];
  mergedInto: string | null; // soft delete
}

export interface Person {
  id: string;
  name: string;
  birthDate: string; // YYYY-MM-DD or ""
  dietary?: string[];
  householdId: string;
  programIds: string[];
  mergedInto: string | null;
}

export interface Pass {
  id: string;
  programId: string;
  kind: PassKind;
  personId: string;
  householdId: string;
  zeffyPaymentId: string | null; // null when created by staff
  purchasedAt: string; // ISO
  validFrom: string; // YYYY-MM-DD, BC time, inclusive
  validThrough: string;
  punchesTotal: number | null;
  status: "active" | "void";
}

export interface Visit {
  id: string;
  programId: string;
  personId: string;
  passId: string | null; // null on staff override
  sessionDate: string; // YYYY-MM-DD, BC time
  checkInAt: string; // ISO
  checkInBy: string;
  checkOutAt?: string;
  checkOutBy?: string;
  checkOutAuto?: boolean;
  punchCost: number;
  override?: { reason: string };
  voided?: boolean;
  voidedBy?: string;
  voidReason?: string;
}

/** Anonymous attendance for headcount programs (food bank, hampers, ...). Doc id = `${programId}_${sessionDate}`. */
export interface Headcount {
  id: string;
  programId: string;
  sessionDate: string;
  count: number;
  updatedAt: string;
  updatedBy: string;
}

export interface StaffMember {
  email: string;
  role: "admin" | "staff";
  /** Program leads: only these programs. Absent/null = all programs. Admins always see all. */
  programIds?: string[] | null;
  invitedBy?: string;
}
