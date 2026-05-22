/**
 * Parse bank / Telebirr SMS bodies for online deposit verification fields.
 */

/**
 * @param {"cbe"|"telebirr"|"cbebirr"} method
 * @param {string} smsText
 * @returns {object}
 */
export function extractOnlineDepositFromSms(method, smsText) {
  const raw = String(smsText ?? "").trim();
  if (!raw) {
    return { ok: false, message: "SMS text is empty." };
  }
  const m = String(method).toLowerCase();

  if (m === "cbe") {
    const match = raw.match(/\bid=([A-Za-z0-9]+)/);
    if (!match) {
      return {
        ok: false,
        message:
          "Could not find a CBE transaction id in the SMS. Paste the full message from the bank.",
      };
    }
    const token = match[1];
    if (token.length <= 8) {
      return {
        ok: false,
        message: "CBE transaction id in SMS is too short.",
      };
    }
    return {
      ok: true,
      reference: token.slice(0, -8),
      accountSuffix: token.slice(-8),
    };
  }

  if (m === "telebirr") {
    let id = null;
    const m1 = raw.match(/transaction\s+number\s+is\s+([A-Za-z0-9]+)/i);
    if (m1) id = m1[1];
    if (!id) {
      const m2 = raw.match(
        /transactioninfo\.ethiotelecom\.et\/receipt\/([A-Za-z0-9]+)/i,
      );
      if (m2) id = m2[1];
    }
    if (!id) {
      return {
        ok: false,
        message:
          "Could not find a Telebirr transaction number in the SMS. Paste the full message.",
      };
    }
    return { ok: true, reference: id };
  }

  if (m === "cbebirr") {
    /** e.g. "Txn ID DD3419QEAOK" or receipt link ?TID=…&PH=… */
    let receiptNumber = null;
    const txnMatch = raw.match(/Txn\.?\s*ID\.?\s*[:.]?\s*([A-Za-z0-9]+)/i);
    if (txnMatch) receiptNumber = txnMatch[1];
    if (!receiptNumber) {
      const tidMatch = raw.match(/[?&]TID=([A-Za-z0-9]+)/i);
      if (tidMatch) receiptNumber = tidMatch[1];
    }
    if (!receiptNumber) {
      return {
        ok: false,
        message:
          "Could not find a CBE Birr transaction id (Txn ID or TID=) in the SMS. Paste the full message.",
      };
    }
    let phoneNumber;
    const phMatch = raw.match(/[?&]PH=(\d{10,15})\b/i);
    if (phMatch) phoneNumber = phMatch[1];
    return {
      ok: true,
      receiptNumber,
      ...(phoneNumber ? { phoneNumber } : {}),
    };
  }

  return { ok: false, message: "Unknown payment method." };
}
