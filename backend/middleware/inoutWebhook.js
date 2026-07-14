/**
 * InOut webhook middleware.
 *
 * Mounted BEFORE the global `express.json()` so we control body parsing on the
 * webhook route. We read the raw body as a Buffer, verify the
 * `X-REQUEST-SIGN` HMAC-SHA256 signature over those exact bytes, then parse the
 * JSON and attach it as `req.inoutBody`.
 *
 * On any failure we respond with a non-200 status (InOut treats anything other
 * than 200 as an error) and an InOut-style `{ code, message }` body.
 *
 * @module middleware/inoutWebhook
 */
import express from "express";
import { verifySignature } from "../lib/inoutSignature.js";
import {
  getInoutSignatureKey,
  isInoutWebhookConfigured,
} from "../Config/inout.js";

/** Raw-body parser: accept any content type so we always capture the bytes. */
export const inoutRawBodyParser = express.raw({
  type: "*/*",
  limit: "1mb",
});

/**
 * Verify the signature and parse the JSON body.
 * @type {import("express").RequestHandler}
 */
export function verifyInoutWebhook(req, res, next) {
  if (!isInoutWebhookConfigured()) {
    console.error("[inout] webhook received but INOUT_SIGNATURE_KEY not set");
    return res.status(500).json({
      code: "TEMPORARY_ERROR",
      message: "Integration not configured",
    });
  }

  const raw = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === "string" ? req.body : "", "utf8");

  const header = req.get("X-REQUEST-SIGN");

  let key;
  try {
    key = getInoutSignatureKey();
  } catch {
    return res.status(500).json({
      code: "TEMPORARY_ERROR",
      message: "Integration not configured",
    });
  }

  if (!verifySignature(raw, header, key)) {
    return res.status(401).json({
      code: "INVALID_TOKEN",
      message: "Signature verification failed",
    });
  }

  try {
    req.inoutBody = raw.length ? JSON.parse(raw.toString("utf8")) : {};
  } catch {
    return res.status(400).json({
      code: "UNKNOWN_ERROR",
      message: "Malformed JSON body",
    });
  }

  return next();
}
