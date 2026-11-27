import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Zeffy webhook signatures, as documented at https://api.zeffy.com/api/docs ("Webhook signatures"):
 *   Zeffy-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "{t}.{rawBody}", keyed with the whsec_ secret>
 * The key is the whole secret string, "whsec_" included (their Node example passes it straight to createHmac).
 * Always verify the raw body bytes, never re-serialized JSON.
 */
export const TOLERANCE_SECONDS = 5 * 60;

export type SignatureResult = { ok: true } | { ok: false; reason: string };

export function verifyZeffySignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Date.now() / 1000,
): SignatureResult {
  if (!secret) return { ok: false, reason: "ZEFFY_WEBHOOK_SECRET not set" };
  if (!header) return { ok: false, reason: "missing Zeffy-Signature header" };
  const values = Object.fromEntries(
    header.split(",").map((part) => {
      const i = part.indexOf("=");
      return [part.slice(0, i).trim(), part.slice(i + 1).trim()];
    }),
  );
  const t = Number(values.t);
  if (!Number.isFinite(t)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return { ok: false, reason: "timestamp outside tolerance" };
  const expected = createHmac("sha256", secret).update(`${values.t}.${rawBody}`).digest();
  const received = Buffer.from(values.v1 ?? "", "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

/** Signs a body the way Zeffy does. For tests. */
export function signLikeZeffy(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}
