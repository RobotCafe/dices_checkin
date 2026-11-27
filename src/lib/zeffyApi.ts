/** Read-only calls to Zeffy's public API (https://api.zeffy.com/api/docs). Server only. */
const BASE = "https://api.zeffy.com/api/v1";

/** GET /v1/payments/:id. Returns null on 404 (deleted). Throws on other errors so the webhook is retried. */
export async function fetchPayment(id: string): Promise<Record<string, any> | null> {
  const key = process.env.ZEFFY_API_KEY;
  if (!key) throw new Error("ZEFFY_API_KEY not set");
  const res = await fetch(`${BASE}/payments/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Zeffy API ${res.status} for payment ${id}`);
  return res.json();
}
