import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ONLINE_DEPOSIT_RECEIVERS,
  verifyResponseMatchesReceivers,
} from "../lib/onlineDepositReceiversConfig.js";

test("verifyResponseMatchesReceivers skips when config empty", () => {
  assert.equal(
    verifyResponseMatchesReceivers("cbe", DEFAULT_ONLINE_DEPOSIT_RECEIVERS, {
      receiver: "Anyone",
    }),
    true,
  );
});

test("verifyResponseMatchesReceivers CBE enforces name + account when set", () => {
  const cfg = {
    ...DEFAULT_ONLINE_DEPOSIT_RECEIVERS,
    cbe: {
      receiverName: "Tewachew Adimasu",
      receiverAccount: "E****0910",
    },
  };
  assert.equal(
    verifyResponseMatchesReceivers("cbe", cfg, {
      receiver: "Tewachew Adimasu",
      receiverAccount: "E12340910",
    }),
    true,
  );
  assert.equal(
    verifyResponseMatchesReceivers("cbe", cfg, {
      receiver: "Other Person",
      receiverAccount: "E12340910",
    }),
    false,
  );
});

test("verifyResponseMatchesReceivers telebirr matches masked account", () => {
  const cfg = {
    ...DEFAULT_ONLINE_DEPOSIT_RECEIVERS,
    telebirr: {
      receiverName: "daniel regasa",
      receiverPhone: "251912345610",
    },
  };
  assert.equal(
    verifyResponseMatchesReceivers("telebirr", cfg, {
      success: true,
      data: {
        creditedPartyName: "daniel regasa",
        creditedPartyAccountNo: "2519****5610",
        transactionStatus: "Completed",
      },
    }),
    true,
  );
});
