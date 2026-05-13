import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM recommended 12 bytes
const AUTH_TAG_LEN = 16;

function getRawKey(): Buffer {
  const specific = process.env.GOOGLE_OAUTH_ENC_KEY;
  const base = specific || process.env.AUTH_SECRET || "";
  if (!base) throw new Error("Encryption key is not configured");
  return scryptSync(base, "google-oauth-field-encryption", KEY_LEN);
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
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
