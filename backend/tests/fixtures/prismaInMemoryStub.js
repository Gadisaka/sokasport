/**
 * Minimal in-memory Prisma client stub for unit testing the settlement
 * service. Implements only the surface area touched by
 * `services/ticketSettlementService.js`:
 *   - findUnique / findFirst / findMany / update / create on
 *     `fixture`, `match`, `ticket`, `ticketSelection`, `wallet`,
 *     `transaction`.
 *   - `$transaction(callback)` that hands the same client back so the
 *     service runs end-to-end.
 *
 * Storage is keyed by id (string) and lookups support the small subset
 * of `where` clauses the service actually issues.
 */

const store = {
  fixture: new Map(),
  match: new Map(),
  ticket: new Map(),
  ticketSelection: new Map(),
  wallet: new Map(),
  transaction: new Map(),
  auditLog: new Map(),
  bonus: new Map(),
  setting: new Map(),
};

// Tracks which references have been written already. Simulates the
// `Transaction.reference @unique` DB constraint so tests can exercise
// the P2002 handling path in the settlement service.
const uniqueReferences = new Set();

export function clearUniqueReferences() {
  uniqueReferences.clear();
}

export function resetStore() {
  for (const map of Object.values(store)) map.clear();
  uniqueReferences.clear();
}

export function getStore() {
  return store;
}

function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = clone(v);
  return out;
}

function matchesWhere(row, where) {
  if (!where) return true;
  for (const [key, condition] of Object.entries(where)) {
    if (key === "id" && typeof condition === "string") {
      if (row.id !== condition) return false;
      continue;
    }
    if (condition && typeof condition === "object" && "in" in condition) {
      if (!condition.in.includes(row[key])) return false;
      continue;
    }
    if (typeof condition === "string" || typeof condition === "number" || condition === null) {
      if (row[key] !== condition) return false;
      continue;
    }
  }
  return true;
}

function model(name) {
  const map = store[name];
  return {
    async findUnique({ where }) {
      if (where?.id) return clone(map.get(where.id) ?? null);
      for (const row of map.values()) {
        if (matchesWhere(row, where)) return clone(row);
      }
      return null;
    },
    async findFirst({ where } = {}) {
      for (const row of map.values()) {
        if (matchesWhere(row, where)) return clone(row);
      }
      return null;
    },
    async findMany({ where } = {}) {
      const out = [];
      for (const row of map.values()) {
        if (matchesWhere(row, where)) out.push(clone(row));
      }
      return out;
    },
    async count({ where } = {}) {
      let n = 0;
      for (const row of map.values()) {
        if (matchesWhere(row, where)) n++;
      }
      return n;
    },
    async update({ where, data }) {
      const row = map.get(where.id);
      if (!row) {
        const err = new Error("Record not found");
        err.code = "P2025";
        throw err;
      }
      const next = { ...row };
      for (const [k, v] of Object.entries(data)) {
        next[k] = v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)
          ? { ...v }
          : v;
      }
      map.set(where.id, next);
      return clone(next);
    },
    async create({ data }) {
      // Simulate `@unique` reference constraint on the transaction
      // model. Any duplicate write throws a Prisma-shaped P2002.
      if (name === "transaction" && data?.reference) {
        if (uniqueReferences.has(data.reference)) {
          const err = new Error(
            `Unique constraint failed on reference=${data.reference}`,
          );
          err.code = "P2002";
          err.meta = { target: ["reference"] };
          throw err;
        }
        uniqueReferences.add(data.reference);
      }
      const id = data.id || `auto-${Math.random().toString(36).slice(2, 10)}`;
      const next = { ...data, id };
      map.set(id, next);
      return clone(next);
    },
  };
}

export const prisma = {
  fixture: model("fixture"),
  match: model("match"),
  ticket: model("ticket"),
  ticketSelection: model("ticketSelection"),
  wallet: model("wallet"),
  transaction: model("transaction"),
  auditLog: model("auditLog"),
  bonus: model("bonus"),
  setting: model("setting"),
  async $transaction(callback) {
    // The in-memory stub doesn't snapshot/rollback; it's only used by
    // happy-path settlement tests where the service runs to completion.
    // Supports the array form (`prisma.$transaction([p1, p2, …])`)
    // as well for backfill-style callers — returns the resolved array.
    if (Array.isArray(callback)) {
      const out = [];
      for (const p of callback) out.push(await p);
      return out;
    }
    return callback(this);
  },
};
