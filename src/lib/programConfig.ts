import type { PassKind, PassTypeConfig, Program } from "./types";

const KINDS: PassKind[] = ["dropin", "punch", "season", "pwyc"];

/** "Label | kind | punches?" per line. */
export function parsePassTypes(text: string): PassTypeConfig[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, kind, punches] = line.split("|").map((s) => s.trim());
      if (!label || !KINDS.includes(kind as PassKind)) throw new Error(`Bad line: "${line}" (kinds: ${KINDS.join(", ")})`);
      const cfg: PassTypeConfig = { label, kind: kind as PassKind };
      if (kind === "punch") cfg.punches = Number(punches) || 10;
      return cfg;
    });
}

export function formatPassTypes(types: PassTypeConfig[]): string {
  return types.map((t) => [t.label, t.kind, t.kind === "punch" ? t.punches : null].filter((x) => x != null).join(" | ")).join("\n");
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const GROWING_UP_DENMAN: Program = {
  id: "growing-up-denman",
  name: "Growing Up Denman",
  mode: "tracked",
  zeffyCampaignId: null, // fill in from the Zeffy campaign (Admin > Programs)
  seasonStart: "2026-11-27",
  seasonEnd: "2027-06-25",
  freeUnderAge: 3,
  passTypes: [
    { label: "Drop-in", kind: "dropin" },
    { label: "Punch card", kind: "punch", punches: 10 },
    { label: "Year Supporter", kind: "season" },
    { label: "Pay what you can", kind: "pwyc" },
  ],
  questions: { name: "child's name", birth: "birth", dietary: "dietary" },
};
