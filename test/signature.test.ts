import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { checkSignature } from "../src/lib/webhookSignature";

const secret = "whsec_" + "ab".repeat(32); // made-up test secret
const body = JSON.stringify({ type: "payment.completed", payment: { id: "p1" } });

test("Standard Webhooks (Svix) signature is recognised", () => {
  const key = Buffer.from(secret.slice(6), "base64");
  const sig = createHmac("sha256", key).update(`msg_1.1795795200.${body}`).digest("base64");
  const h = new Headers({ "webhook-id": "msg_1", "webhook-timestamp": "1795795200", "webhook-signature": `v1,${sig}` });
  const r = checkSignature(h, body, secret);
  assert.equal(r.matched, "webhook-signature|id.ts.body|base64-key|base64");
  assert.deepEqual(r.headerNames, ["webhook-id", "webhook-signature", "webhook-timestamp"]);
});

test("Stripe-style t=,v1= with a hex key is recognised", () => {
  const sig = createHmac("sha256", Buffer.from(secret.slice(6), "hex")).update(`1795795200.${body}`).digest("hex");
  const h = new Headers({ "x-zeffy-signature": `t=1795795200,v1=${sig}` });
  assert.equal(checkSignature(h, body, secret).matched, "x-zeffy-signature|ts.body|hex-key|hex");
});

test("forged or missing signatures don't match", () => {
  const h = new Headers({ "webhook-id": "msg_1", "webhook-timestamp": "1", "webhook-signature": "v1,AAAA" });
  assert.equal(checkSignature(h, body, secret).matched, null);
  assert.equal(checkSignature(new Headers(), body, secret).matched, null);
  const tampered = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`msg_1.1.${body}x`).digest("base64");
  assert.equal(checkSignature(new Headers({ "webhook-id": "msg_1", "webhook-timestamp": "1", "webhook-signature": `v1,${tampered}` }), body, secret).matched, null);
});
