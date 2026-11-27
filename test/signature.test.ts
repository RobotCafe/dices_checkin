import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { signLikeZeffy, verifyZeffySignature } from "../src/lib/webhookSignature";

const secret = "whsec_" + "ab".repeat(32); // made-up test secret
const body = JSON.stringify({ id: "evt_1", type: "payment.completed", data: { id: "p1" } });
const now = 1795795200;

test("a delivery signed as Zeffy documents is accepted", () => {
  // Independent of signLikeZeffy: HMAC-SHA256 keyed with the whole whsec_ string, hex, over "{t}.{rawBody}".
  const v1 = createHmac("sha256", secret).update(`${now}.${body}`).digest("hex");
  assert.deepEqual(verifyZeffySignature(body, `t=${now},v1=${v1}`, secret, now), { ok: true });
  assert.deepEqual(verifyZeffySignature(body, signLikeZeffy(body, secret, now), secret, now + 60), { ok: true });
});

test("tampered body, wrong secret, missing header are rejected", () => {
  const h = signLikeZeffy(body, secret, now);
  assert.equal(verifyZeffySignature(body + " ", h, secret, now).ok, false);
  assert.equal(verifyZeffySignature(body, h, "whsec_other", now).ok, false);
  assert.equal(verifyZeffySignature(body, null, secret, now).ok, false);
  assert.equal(verifyZeffySignature(body, "t=abc,v1=00", secret, now).ok, false);
  assert.equal(verifyZeffySignature(body, h, "", now).ok, false);
});

test("old or future timestamps are rejected (5 minute tolerance, replay protection)", () => {
  assert.equal(verifyZeffySignature(body, signLikeZeffy(body, secret, now - 301), secret, now).ok, false);
  assert.equal(verifyZeffySignature(body, signLikeZeffy(body, secret, now + 301), secret, now).ok, false);
  assert.equal(verifyZeffySignature(body, signLikeZeffy(body, secret, now - 299), secret, now).ok, true);
});
