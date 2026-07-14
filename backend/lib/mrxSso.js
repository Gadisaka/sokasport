/**
 * MRX SSO token encryption helpers.
 *
 * Token format: "<iv_hex>:<ciphertext_hex>" (AES-256-CBC).
 * Payload: { phone, name, timestamp } — phone in local 0XXXXXXXXX form.
 *
 * @module lib/mrxSso
 */
import crypto from "node:crypto";
import { toLocalEthiopiaPhone } from "./phone.js";

/**
 * @returns {Buffer} 32-byte AES key from MRX_ENCRYPTION_KEY
 */
export function getMrxEncryptionKeyBuffer() {
  const key = process.env.MRX_ENCRYPTION_KEY;
  if (!key || typeof key !== "string") {
    throw new Error("MRX_ENCRYPTION_KEY is not set");
  }
  const hex = key.trim().slice(0, 64);
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("MRX_ENCRYPTION_KEY must be at least 64 hex characters");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Build and encrypt an SSO token for MRX game launch.
 *
 * @param {{ phone: string, name: string, timestamp?: number }} player
 * @returns {string} iv_hex:ciphertext_hex
 */
export function encryptMrxSsoToken({ phone, name, timestamp = Date.now() }) {
  const payload = JSON.stringify({
    phone: toLocalEthiopiaPhone(phone),
    name: name || toLocalEthiopiaPhone(phone),
    timestamp,
  });

  const keyBuffer = getMrxEncryptionKeyBuffer();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", keyBuffer, iv);
  const encrypted = Buffer.concat([
    cipher.update(payload, "utf8"),
    cipher.final(),
  ]);

  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt an SSO token (used in tests / local verification).
 *
 * @param {string} ssoToken
 * @returns {{ phone: string, name: string, timestamp: number }}
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
