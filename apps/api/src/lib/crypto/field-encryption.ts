import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM recommended 12 bytes
const AUTH_TAG_LEN = 16;

let cachedRawKey: Buffer | undefined;

function getGoogleOAuthEncryptionSecret(): string {
  const base = process.env.GOOGLE_OAUTH_ENC_KEY?.trim();
  if (!base) {
    throw new Error("GOOGLE_OAUTH_ENC_KEY environment variable is required");
  }
  return base;
}

export function assertGoogleOAuthEncryptionKeyConfigured(): void {
  getGoogleOAuthEncryptionSecret();
}

function getRawKey(): Buffer {
  // API processes must be restarted to pick up encryption key rotations.
  // The cache avoids repeated synchronous KDF work on OAuth token hot paths.
  if (cachedRawKey) return cachedRawKey;
  const base = getGoogleOAuthEncryptionSecret();
  // Derive a fixed length key using scrypt
  cachedRawKey = scryptSync(base, "google-oauth-field-encryption", KEY_LEN);
  return cachedRawKey;
}

export function encryptToBase64(plaintext: string): string {
  const key = getRawKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_LEN,
  });
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptFromBase64(payload: string): string {
  const key = getRawKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + AUTH_TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + AUTH_TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_LEN,
  });
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
  return plaintext;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
