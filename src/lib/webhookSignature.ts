import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Zeffy signs webhooks with a "whsec_..." secret but doesn't document the scheme (checked 2026-11-26).
 * The prefix suggests Standard Webhooks (Svix): headers webhook-id / webhook-timestamp / webhook-signature,
 * HMAC-SHA256 over `${id}.${timestamp}.${body}`, signature "v1,<base64>", key = base64 of the part after whsec_.
 *
 * Until a real delivery confirms the scheme, the webhook runs this in OBSERVE mode: it tries the likely
 * variants, records which one matched (or none) on the payment doc, and does not reject anything.
 * Once confirmed, keep only the matching variant and reject on mismatch.
 */

export interface SignatureCheck {
  matched: string | null; // e.g. "webhook-signature|id.ts.body|base64-key|base64"
  headerNames: string[]; // header names only (no values) so the scheme can be read off a real delivery
  timestamp: string | null;
}

const SIG_HEADERS = ["webhook-signature", "svix-signature", "zeffy-signature", "x-zeffy-signature", "x-webhook-signature", "x-signature", "signature"];
const ID_HEADERS = ["webhook-id", "svix-id", "zeffy-id", "x-zeffy-id", "x-webhook-id"];
const TS_HEADERS = ["webhook-timestamp", "svix-timestamp", "zeffy-timestamp", "x-zeffy-timestamp", "x-webhook-timestamp", "x-timestamp"];

function first(h: Headers, names: string[]): [string, string] | null {
  for (const n of names) {
    const v = h.get(n);
    if (v) return [n, v];
  }
  return null;
}

/** Candidate signatures in a header value: "v1,abc v1,def", "t=1,v1=abc", "sha256=abc" or a bare value. */
function candidates(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(/[\s,;]+/)) {
    const p = part.trim();
    if (!p || p === "v1" || /^t=/.test(p)) continue;
    out.push(p.replace(/^(v1=|v1,|sha256=)/, ""));
  }
  if (/^v1,/.test(value.trim())) out.push(value.trim().slice(3));
  return [...new Set(out)];
}

function keys(secret: string): [string, Buffer][] {
  const bare = secret.replace(/^whsec_/, "");
  const ks: [string, Buffer][] = [["base64-key", Buffer.from(bare, "base64")], ["text-key", Buffer.from(bare, "utf8")], ["full-text-key", Buffer.from(secret, "utf8")]];
  if (/^[0-9a-f]+$/i.test(bare) && bare.length % 2 === 0) ks.push(["hex-key", Buffer.from(bare, "hex")]);
  return ks;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function checkSignature(headers: Headers, body: string, secret: string): SignatureCheck {
  const headerNames = [...headers.keys()].sort();
  const sig = first(headers, SIG_HEADERS);
  const id = first(headers, ID_HEADERS);
  const ts = first(headers, TS_HEADERS);
  // Stripe-style "t=123,v1=abc" carries the timestamp inside the signature header.
  const inlineTs = sig?.[1].match(/(?:^|,)t=(\d+)/)?.[1] ?? null;
  const timestamp = ts?.[1] ?? inlineTs;
  const result: SignatureCheck = { matched: null, headerNames, timestamp };
  if (!sig || !secret) return result;

  const signed: [string, string][] = [["body", body]];
  if (timestamp) signed.unshift(["ts.body", `${timestamp}.${body}`]);
  if (id && timestamp) signed.unshift(["id.ts.body", `${id[1]}.${timestamp}.${body}`]);

  const given = candidates(sig[1]);
  for (const [kName, key] of keys(secret)) {
    for (const [sName, payload] of signed) {
      const mac = createHmac("sha256", key).update(payload).digest();
      for (const [eName, enc] of [["base64", mac.toString("base64")], ["hex", mac.toString("hex")]] as const) {
        if (given.some((g) => same(g, enc))) {
          result.matched = `${sig[0]}|${sName}|${kName}|${eName}`;
          return result;
        }
      }
    }
  }
  return result;
}
