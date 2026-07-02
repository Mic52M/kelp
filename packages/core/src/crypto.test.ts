import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { sealSecret, openSecret } from "./crypto.js";

const KEY = randomBytes(32).toString("base64");

test("round-trips a secret", () => {
  const plaintext = "sb_service_role_super_secret_value";
  const sealed = sealSecret(plaintext, KEY);
  assert.equal(openSecret(sealed, KEY), plaintext);
});

test("ciphertext does not contain the plaintext", () => {
  const sealed = sealSecret("plaintext-marker-1234", KEY);
  assert.ok(!sealed.ciphertext.toString("utf8").includes("plaintext-marker"));
});

test("nonce is unique per call", () => {
  const a = sealSecret("x", KEY);
  const b = sealSecret("x", KEY);
  assert.notEqual(a.nonce.toString("hex"), b.nonce.toString("hex"));
});

test("tampering with ciphertext throws", () => {
  const sealed = sealSecret("x", KEY);
  sealed.ciphertext[0] = sealed.ciphertext[0]! ^ 0xff;
  assert.throws(() => openSecret(sealed, KEY));
});

test("wrong key throws", () => {
  const sealed = sealSecret("x", KEY);
  const otherKey = randomBytes(32).toString("base64");
  assert.throws(() => openSecret(sealed, otherKey));
});

test("rejects a key of the wrong length", () => {
  assert.throws(() => sealSecret("x", Buffer.alloc(16).toString("base64")));
});
