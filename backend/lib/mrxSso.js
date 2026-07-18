/**
 * MRX SSO token encryption helpers.
 *
 * Matches MRX playerSso reference:
 *   - AES-256-CBC
 *   - key = Buffer.from(MRX_ENCRYPTION_KEY.slice(0, 64), "hex")
 *   - token = "<iv_hex>:<ciphertext_hex>"
 *   - payload = { phone, name, balance, timestamp } (phone as stored / passed in)
 *
 * @module lib/mrxSso
 */
import crypto from "node:crypto";

/** Guide / local-dev default — must match MRX when used. Prefer env in production. */
const DEFAULT_MRX_ENCRYPTION_KEY =
  "a1b6783d4e5f6789012345901234567890123456789901234567890123456782";

/**
 * Resolve encryption key string (env, else reference default).
 * @returns {string}
 */
export function getMrxEncryptionKey() {
  return (
    process.env.MRX_ENCRYPTION_KEY || DEFAULT_MRX_ENCRYPTION_KEY
  ).trim();
}

/**
 * @returns {Buffer} 32-byte AES key — same derivation as MRX playerSso.js
 */
export function getMrxEncryptionKeyBuffer() {
  const key = getMrxEncryptionKey();
  return Buffer.from(key.slice(0, 64), "hex");
}

/**
 * Build and encrypt an SSO token for MRX game launch.
 *
 * @param {{ phone: string, name: string, balance?: number, timestamp?: number }} player
 * @returns {string} iv_hex:ciphertext_hex
 */
export function encryptMrxSsoToken({
  phone,
  name,
  balance = 0,
  timestamp = Date.now(),
}) {
  const numericBalance = Number(balance);
  const payload = JSON.stringify({
    phone,
    name: name || phone,
    balance: Number.isFinite(numericBalance) ? numericBalance : 0,
    timestamp,
  });

  const keyBuffer = getMrxEncryptionKeyBuffer();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", keyBuffer, iv);
  const encrypted = Buffer.concat([
    cipher.update(payload, "utf8"),
    cipher.final(),
  ]);

  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

/**
 * Decrypt an SSO token (used in tests / local verification).
 *
 * @param {string} ssoToken
 * @returns {{ phone: string, name: string, balance: number, timestamp: number }}
 */
export function decryptMrxSsoToken(ssoToken) {
  const [ivHex, cipherHex] = String(ssoToken ?? "").split(":");
  if (!ivHex || !cipherHex) {
    throw new Error("Invalid SSO token format");
  }
  const keyBuffer = getMrxEncryptionKeyBuffer();
  const decipher = crypto.createDecipheriv(
    "aes-256-cbc",
    keyBuffer,
    Buffer.from(ivHex, "hex"),
  );
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherHex, "hex")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}
