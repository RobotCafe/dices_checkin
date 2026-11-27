// BC has no daylight saving; Zeffy is set to GMT-7. One place to change if that ever changes.
export const OFFSET_HOURS = -7;

/** YYYY-MM-DD of the given instant in BC time. */
export function bcDate(d: Date): string {
  const shifted = new Date(d.getTime() + OFFSET_HOURS * 3600_000);
  return shifted.toISOString().slice(0, 10);
}

/** Whole years between a YYYY-MM-DD birth date and a YYYY-MM-DD day. */
export function ageOn(birthDate: string, day: string): number {
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}
