/**
 * InOut webhook signature helpers.
 *
 * The provider signs the request body in its ORIGINAL (raw) form with
 * HMAC-SHA256, using the signature key issued on connection, and sends the
 * hex digest in the `X-REQUEST-SIGN` header. We must compute the digest over
 * the exact raw bytes we received — re-serializing parsed JSON would change
 * key order/spacing and break verification.
 *
 * @module lib/inoutSignature
 */
import crypto from "node:crypto";

/**
 * Compute the hex HMAC-SHA256 signature of a raw body.
 *
 * @param {Buffer|string} rawBody Raw request body bytes (or string).
 * @param {string} key Signature key.
 * @returns {string} Lowercase hex digest.
 */
export function computeSignature(rawBody, key) {
  const buf = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(String(rawBody ?? ""), "utf8");
  return crypto.createHmac("sha256", key).update(buf).digest("hex");
}

/**
 * Constant-time comparison of the received header against the expected digest.
 *
 * @param {Buffer|string} rawBody Raw request body bytes.
 * @param {string|undefined|null} headerValue Value of `X-REQUEST-SIGN`.
 * @param {string} key Signature key.
 * @returns {boolean} True when the signature is valid.
 */
export function verifySignature(rawBody, headerValue, key) {
  if (!headerValue || typeof headerValue !== "string" || !key) {
    return false;
  }
  const expected = computeSignature(rawBody, key);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(headerValue.trim().toLowerCase(), "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}
