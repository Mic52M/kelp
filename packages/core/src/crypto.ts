// Encryption of customer credentials at rest.
//
// All customer secrets (Supabase Management tokens, GitHub installation tokens,
// BOLA test-account credentials) are stored as ciphertext in the DB. We use
// AES-256-GCM (authenticated encryption): the auth tag detects tampering and is
// stored alongside the ciphertext. The 256-bit key comes from
// KELP_CREDENTIAL_ENC_KEY (base64), never hard-coded.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12; // 96-bit nonce recommended for GCM
const TAG_BYTES = 16;

export interface SealedSecret {
  /** ciphertext || auth tag (tag appended). */
  ciphertext: Buffer;
  /** per-message random nonce. */
  nonce: Buffer;
}

function loadKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `KELP_CREDENTIAL_ENC_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

/** Encrypt a UTF-8 secret. Returns ciphertext (with appended tag) and nonce. */
export function sealSecret(plaintext: string, keyBase64: string): SealedSecret {
  const key = loadKey(keyBase64);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGO, key, nonce);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([body, tag]), nonce };
}

/** Decrypt what sealSecret produced. Throws if the data was tampered with. */
export function openSecret(sealed: SealedSecret, keyBase64: string): string {
  const key = loadKey(keyBase64);
  if (sealed.ciphertext.length < TAG_BYTES) {
    throw new Error("ciphertext too short to contain an auth tag");
  }
  const body = sealed.ciphertext.subarray(0, sealed.ciphertext.length - TAG_BYTES);
  const tag = sealed.ciphertext.subarray(sealed.ciphertext.length - TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, sealed.nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
