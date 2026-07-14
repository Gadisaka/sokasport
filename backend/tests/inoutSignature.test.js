import test from "node:test";
import assert from "node:assert/strict";
import { computeSignature, verifySignature } from "../lib/inoutSignature.js";

// Known vector from the InOut backend documentation (section 2.2).
const DOC_BODY =
  '{"action":"init","token":"AuthToken","data":{"currency":"USD","operator":"OperatorId","gameMode":"GameMode"}}';
const DOC_KEY =
  "7A2DB2F4FE86998735835F538826B262E834662EA297AB8B4286DBFE315A2467521D791A94E3D12A942427A29F";
const DOC_SIGN =
  "407c4890d288f37fbd7ced0ce73857e77596dcfd4457a296d95ab99d5a97b6b7";

test("computeSignature matches the documented vector (string body)", () => {
  assert.equal(computeSignature(DOC_BODY, DOC_KEY), DOC_SIGN);
});

test("computeSignature matches the documented vector (buffer body)", () => {
  assert.equal(computeSignature(Buffer.from(DOC_BODY, "utf8"), DOC_KEY), DOC_SIGN);
});

test("verifySignature accepts the correct signature", () => {
  assert.equal(verifySignature(DOC_BODY, DOC_SIGN, DOC_KEY), true);
});

test("verifySignature is case-insensitive on the hex header", () => {
  assert.equal(verifySignature(DOC_BODY, DOC_SIGN.toUpperCase(), DOC_KEY), true);
});

test("verifySignature rejects a tampered body", () => {
  const tampered = DOC_BODY.replace("AuthToken", "Attacker");
  assert.equal(verifySignature(tampered, DOC_SIGN, DOC_KEY), false);
});

test("verifySignature rejects a wrong key", () => {
  assert.equal(verifySignature(DOC_BODY, DOC_SIGN, "wrong-key"), false);
});

test("verifySignature rejects missing/empty header", () => {
  assert.equal(verifySignature(DOC_BODY, "", DOC_KEY), false);
  assert.equal(verifySignature(DOC_BODY, null, DOC_KEY), false);
});
