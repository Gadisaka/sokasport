import assert from "node:assert/strict";
import test from "node:test";
import {
  amountsMatch,
  buildOnlinePayLedgerReference,
  isSuccessfulVerification,
  normalizeEthiopiaPhone,
  parseEtbMoneyString,
  parseVerifiedAmountEtb,
  parseVerifiedPaymentDate,
} from "../lib/onlineDepositVerify.js";

test("parseEtbMoneyString handles commas and suffix text", () => {
  assert.equal(parseEtbMoneyString("3,000.00 ETB"), 3000);
  assert.equal(parseEtbMoneyString("101.00 Birr"), 101);
  assert.equal(parseEtbMoneyString(73000), 73000);
  assert.equal(parseEtbMoneyString(null), null);
});

test("normalizeEthiopiaPhone adds 251 prefix", () => {
  assert.equal(normalizeEthiopiaPhone("0912345678"), "251912345678");
  assert.equal(normalizeEthiopiaPhone("251912345678"), "251912345678");
  assert.equal(normalizeEthiopiaPhone("912345678"), "251912345678");
});

test("buildOnlinePayLedgerReference is stable and unique per channel", () => {
  assert.equal(
    buildOnlinePayLedgerReference("telebirr", { reference: "CE626EJRNS" }),
    "online-pay:telebirr:CE626EJRNS",
  );
  assert.equal(
    buildOnlinePayLedgerReference("cbe", {
      reference: "TXN1",
      accountSuffix: "12345678",
    }),
    "online-pay:cbe:TXN1:12345678",
  );
  assert.equal(
    buildOnlinePayLedgerReference("cbebirr", {
      receiptNumber: "R1",
      phoneNumber: "0912345678",
    }),
    "online-pay:cbebirr:R1:251912345678",
  );
});

test("isSuccessfulVerification per provider shape", () => {
  assert.equal(isSuccessfulVerification("cbe", { success: true }), true);
  assert.equal(isSuccessfulVerification("cbe", { success: false }), false);

  assert.equal(
    isSuccessfulVerification("cbebirr", { transactionStatus: "Completed" }),
    true,
  );
  assert.equal(
    isSuccessfulVerification("cbebirr", { transactionStatus: "Failed" }),
    false,
  );

  assert.equal(
    isSuccessfulVerification("telebirr", {
      success: true,
      data: { transactionStatus: "Completed" },
    }),
    true,
  );
  assert.equal(
    isSuccessfulVerification("telebirr", {
      success: true,
      data: { transactionStatus: "Pending" },
    }),
    false,
  );
});

test("parseVerifiedAmountEtb reads nested telebirr data (settledAmount preferred)", () => {
  assert.equal(
    parseVerifiedAmountEtb("telebirr", {
      success: true,
      data: { settledAmount: "10 Birr", totalPaidAmount: "11 Birr" },
    }),
    10,
  );
  assert.equal(
    parseVerifiedAmountEtb("telebirr", {
      success: true,
      data: { totalPaidAmount: "101.00 Birr" },
    }),
    101,
  );
  assert.equal(
    parseVerifiedAmountEtb("cbebirr", { totalPaidAmount: "73000.00" }),
    73000,
  );
});

test("amountsMatch tolerates tiny float noise", () => {
  assert.equal(amountsMatch(100, 100.005), true);
  assert.equal(amountsMatch(100, 100.02), false);
});

test("ledger reference is case-stable so one receipt cannot fork into two keys", () => {
  assert.equal(
    buildOnlinePayLedgerReference("cbebirr", {
      receiptNumber: "dg021jau6e0",
      phoneNumber: "0912345678",
    }),
    buildOnlinePayLedgerReference("cbebirr", {
      receiptNumber: "DG021JAU6E0",
      phoneNumber: "251912345678",
    }),
  );
  assert.equal(
    buildOnlinePayLedgerReference("telebirr", { reference: "ce626ejrns" }),
    "online-pay:telebirr:CE626EJRNS",
  );
});

test("parseVerifiedPaymentDate reads each provider's date format", () => {
  assert.equal(
    parseVerifiedPaymentDate("cbebirr", {
      transactionDate: "2026-08-06 17:29",
    })?.toISOString(),
    "2026-08-06T17:29:00.000Z",
  );
  assert.equal(
    parseVerifiedPaymentDate("telebirr", {
      data: { paymentDate: "07-08-2026 17:37:39" },
    })?.toISOString(),
    "2026-08-07T17:37:39.000Z",
  );
  assert.equal(parseVerifiedPaymentDate("cbebirr", {}), null);
  assert.equal(parseVerifiedPaymentDate("cbebirr", { transactionDate: "n/a" }), null);
});
