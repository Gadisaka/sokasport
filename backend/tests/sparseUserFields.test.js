import test from "node:test";
import assert from "node:assert/strict";
import { uniqueViolationMentions } from "../lib/sparseUserFields.js";

test("uniqueViolationMentions matches array target fields", () => {
  assert.equal(
    uniqueViolationMentions({ meta: { target: ["phone"] } }, "phone"),
    true,
  );
  assert.equal(
    uniqueViolationMentions({ meta: { target: ["email"] } }, "phone"),
    false,
  );
});

test("uniqueViolationMentions matches index-name style string targets", () => {
  assert.equal(
    uniqueViolationMentions(
      { meta: { target: "users_phone_key" } },
      "phone",
    ),
    true,
  );
  assert.equal(
    uniqueViolationMentions(
      { meta: { target: "users_username_key" } },
      "username",
    ),
    true,
  );
  assert.equal(
    uniqueViolationMentions(
      { meta: { target: "users_username_key" } },
      "phone",
    ),
    false,
  );
});

test("uniqueViolationMentions is false when meta is missing", () => {
  assert.equal(uniqueViolationMentions({}, "phone"), false);
  assert.equal(uniqueViolationMentions(null, "phone"), false);
});
