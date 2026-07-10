import test from "node:test";
import assert from "node:assert/strict";
import {
  commitHeldTicket,
  refundHeldTicket,
} from "../services/heldTicketService.js";
import { runHoldReaper } from "../jobs/holdReaper.js";

const passLock = (walletId, _opts, cb) => cb({ walletId });

test("commitHeldTicket: HELD→OPEN, committed exactly once", async () => {
  let calls = 0;
  const db = {
    ticket: {
      async updateMany({ where, data }) {
        calls += 1;
        assert.equal(where.status, "HELD");
        assert.equal(data.status, "OPEN");
        return { count: calls === 1 ? 1 : 0 };
      },
    },
  };
  assert.equal(await commitHeldTicket("t1", { db }), true);
  assert.equal(await commitHeldTicket("t1", { db }), false);
});

function refundDb({ ticket, wallet = { id: "w1" }, tx }) {
  return {
    ticket: { async findUnique() { return ticket; } },
    wallet: { async findFirst() { return wallet; } },
    async $transaction(cb) {
      return cb(tx);
    },
  };
}

test("refundHeldTicket: HELD + player wallet → CANCELED + single stake credit", async () => {
  const events = [];
  const tx = {
    ticket: {
      async updateMany({ data }) {
        events.push(["claim", data.status]);
        return { count: 1 };
      },
    },
    transaction: {
      async findFirst() {
        return null;
      },
      async create({ data }) {
        events.push([
          "credit",
          data.reference,
          data.type,
          data.amount,
          data.balance_before,
          data.balance_after,
        ]);
        return {};
      },
    },
    wallet: {
      async findUnique() {
        return { balance: 100 };
      },
      async update({ data }) {
        events.push(["balance", data.balance]);
        return {};
      },
    },
  };
  const db = refundDb({
    ticket: { id: "t1", status: "HELD", user_id: "u1", stake: 25 },
    tx,
  });
  const res = await refundHeldTicket("t1", { db, lock: passLock });
  assert.equal(res.canceled, true);
  assert.equal(res.refunded, 25);
  assert.deepEqual(events, [
    ["claim", "CANCELED"],
    ["balance", 125],
    ["credit", "hold-refund:t1", "DEPOSIT", 25, 100, 125],
  ]);
});

test("runHoldReaper: age-filters HELD tickets and refunds each via injected refund", async () => {
  let capturedWhere = null;
  const db = {
    ticket: {
      async findMany({ where }) {
        capturedWhere = where;
        return [{ id: "a" }, { id: "b" }, { id: "c" }];
      },
    },
  };
  const refundedIds = [];
  const refund = async (id) => {
    refundedIds.push(id);
    return { canceled: id !== "c", refunded: id !== "c" ? 10 : 0, reason: "x" };
  };
  const NOW = 1_000_000;
  const res = await runHoldReaper({ db, refund, now: NOW });

  assert.equal(capturedWhere.status, "HELD");
  assert.ok(capturedWhere.created_at.lt instanceof Date);
  assert.deepEqual(refundedIds, ["a", "b", "c"]);
  assert.equal(res.scanned, 3);
  assert.equal(res.refunded, 2);
  assert.equal(res.skipped, 1);
});
