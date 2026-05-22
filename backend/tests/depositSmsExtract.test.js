import assert from "node:assert/strict";
import test from "node:test";
import { extractOnlineDepositFromSms } from "../lib/depositSmsExtract.js";

const CBE_SMS =
  "Dear Gadisa, You have transfered ETB 10.00 to Tewachew Adimasu on 05/04/2026 at 14:09:13 from your account 1*****2425. Your account has been debited with a S.charge of ETB 0.50 and VAT(15%) of ETB0.08 and Disaster Fund (5%) of ETB0.03, with a total of ETB 10.61. Your Current Balance is ETB 3,410.44. Thank you for Banking with CBE! https://apps.cbe.com.et:100/?id=FT26095YRWP545822425 For feedback click the link https://forms.gle/R1s9nkJ6qZVCxRVu9";

const TELEBIRR_SMS =
  "Dear Walelign \nYou have transferred ETB 30.00 to daniel regasa (2519****5610) on 02/04/2026 11:59:46. Your transaction number is DD23HGV3T7. The service fee is  ETB 0.87 and  15% VAT on the service fee is ETB 0.13. Your current E-Money Account  balance is ETB 395.84. To download your payment information please click this link: https://transactioninfo.ethiotelecom.et/receipt/DD23HGV3T7.\n\nThank you for using telebirr\nEthio telecom";

test("extractOnlineDepositFromSms CBE parses id= token into reference + suffix", () => {
  const r = extractOnlineDepositFromSms("cbe", CBE_SMS);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.reference, "FT26095YRWP5");
    assert.equal(r.accountSuffix, "45822425");
  }
});

test("extractOnlineDepositFromSms telebirr parses transaction number", () => {
  const r = extractOnlineDepositFromSms("telebirr", TELEBIRR_SMS);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.reference, "DD23HGV3T7");
  }
});

test("extractOnlineDepositFromSms telebirr fallback receipt URL", () => {
  const r = extractOnlineDepositFromSms(
    "telebirr",
    "x https://transactioninfo.ethiotelecom.et/receipt/AB12CD34EF",
  );
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.reference, "AB12CD34EF");
});

const CBE_BIRR_SMS =
  "Dear Gadisa, you have sent 10.00Br. to AMANUEL LEGESSE on 03/04/26 15:03,Txn ID DD3419QEAOK. Your CBE Birr account balance is 3.07Br.Thank you! For invoice https://cbepay1.cbe.com.et/aureceipt?TID=DD3419QEAOK&PH=251982828380 For your feedback please click the link https://shorturl.at/gy3A0";

test("extractOnlineDepositFromSms cbebirr parses Txn ID and PH from invoice link", () => {
  const r = extractOnlineDepositFromSms("cbebirr", CBE_BIRR_SMS);
  assert.equal(r.ok, true);
  if (r.ok && "receiptNumber" in r) {
    assert.equal(r.receiptNumber, "DD3419QEAOK");
    assert.equal(r.phoneNumber, "251982828380");
  }
});

test("extractOnlineDepositFromSms cbebirr TID fallback when Tx.line missing", () => {
  const r = extractOnlineDepositFromSms(
    "cbebirr",
    "invoice https://cbepay1.cbe.com.et/aureceipt?TID=XX99YY&PH=251911122233",
  );
  assert.equal(r.ok, true);
  if (r.ok && "receiptNumber" in r) {
    assert.equal(r.receiptNumber, "XX99YY");
    assert.equal(r.phoneNumber, "251911122233");
  }
});

test("extractOnlineDepositFromSms cbebirr fails when no id", () => {
  const r = extractOnlineDepositFromSms("cbebirr", "no transaction here");
  assert.equal(r.ok, false);
});
