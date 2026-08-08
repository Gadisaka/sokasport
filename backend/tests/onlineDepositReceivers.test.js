import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_ONLINE_DEPOSIT_RECEIVERS,
  isReceiverConfigured,
  verifyResponseMatchesReceivers,
} from "../lib/onlineDepositReceiversConfig.js";

test("unconfigured channel never matches (fail closed)", () => {
  for (const method of ["cbe", "telebirr", "cbebirr"]) {
    assert.equal(isReceiverConfigured(method, DEFAULT_ONLINE_DEPOSIT_RECEIVERS), false);
  }
  assert.equal(
    verifyResponseMatchesReceivers("cbe", DEFAULT_ONLINE_DEPOSIT_RECEIVERS, {
      receiver: "Anyone",
      receiverAccount: "1000123456789",
    }),
    false,
  );
  assert.equal(
    verifyResponseMatchesReceivers("cbebirr", DEFAULT_ONLINE_DEPOSIT_RECEIVERS, {
      transactionStatus: "Completed",
      receiverName: "0910872474 - SOME PERSON",
      creditAccount: "0910872474 - SOME PERSON",
    }),
    false,
  );
  assert.equal(
    verifyResponseMatchesReceivers("telebirr", DEFAULT_ONLINE_DEPOSIT_RECEIVERS, {
      success: true,
      data: { creditedPartyName: "Anyone", creditedPartyAccountNo: "2519****0278" },
    }),
    false,
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
  assert.equal(
    verifyResponseMatchesReceivers("telebirr", cfg, {
      success: true,
      data: {
        creditedPartyName: "asrar nurhusen muhammud",
        creditedPartyAccountNo: "2519****0278",
        transactionStatus: "Completed",
      },
    }),
    false,
  );
});

test("cbebirr credits only payments that reached the platform wallet", () => {
  const cfg = {
    ...DEFAULT_ONLINE_DEPOSIT_RECEIVERS,
    cbebirr: {
      receiverName: "",
      receiverPhone: "0912345678",
      receiverAccount: "",
    },
  };
  assert.equal(isReceiverConfigured("cbebirr", cfg), true);

  assert.equal(
    verifyResponseMatchesReceivers("cbebirr", cfg, {
      transactionStatus: "Completed",
      creditAccount: "251912345678 - PLATFORM ACCOUNT",
      receiverName: "251912345678 - PLATFORM ACCOUNT",
    }),
    true,
  );

  // Regression: real P2P "Send Money" receipt to an unrelated person.
  assert.equal(
    verifyResponseMatchesReceivers("cbebirr", cfg, {
      transactionStatus: "Completed",
      creditAccount: "0910872474 - WENDESEN MESELE DEJENE",
      receiverName: "0910872474 - WENDESEN MESELE DEJENE",
    }),
    false,
  );

  // Regression: a missing creditAccount must not pass the identifier check.
  assert.equal(
    verifyResponseMatchesReceivers("cbebirr", cfg, {
      transactionStatus: "Completed",
      creditAccount: "",
      receiverName: "",
    }),
    false,
  );
});

test("cbebirr accepts wallet-to-bank transfers on the configured account", () => {
  const cfg = {
    ...DEFAULT_ONLINE_DEPOSIT_RECEIVERS,
    cbebirr: {
      receiverName: "",
      receiverPhone: "",
      receiverAccount: "1000012344273",
    },
  };
  assert.equal(
    verifyResponseMatchesReceivers("cbebirr", cfg, {
      transactionStatus: "Completed",
      creditAccount: "1000****4273 - CBE",
      receiverName: "PLATFORM OWNER",
    }),
    true,
  );
  assert.equal(
    verifyResponseMatchesReceivers("cbebirr", cfg, {
      transactionStatus: "Completed",
      creditAccount: "1000****9999 - CBE",
      receiverName: "KALEB KASAHUN KARA",
    }),
    false,
  );
});
