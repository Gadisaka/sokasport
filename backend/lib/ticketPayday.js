/**
 * Ticket payout dating: sales stay on created_at; paid stats use paid_at.
 */

export const PAYDAY_LIST_STATUSES = new Set(["PAID", "CASHBACK_PAID"]);

export function isPaydayListStatus(status) {
  return PAYDAY_LIST_STATUSES.has(String(status || "").toUpperCase());
}

/** Date field for GET /tickets?date= when a status filter is also present. */
export function ticketListDateField(status) {
  return isPaydayListStatus(status) ? "paid_at" : "created_at";
}

export function ticketListOrderBy(status) {
  return isPaydayListStatus(status)
    ? { paid_at: "desc" }
    : { created_at: "desc" };
}

export function payoutStatusWrite(status, paidAt = new Date()) {
  return { status, paid_at: paidAt };
}

function ymdUtc(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const ONLINE_CASHIER_KEY = "__online__";

function emptyBranchRow(branchName) {
  return {
    branchName,
    tickets: 0,
    stake: 0,
    open: 0,
    won: 0,
    lost: 0,
    paid: 0,
    cashbackPaid: 0,
  };
}

function emptyCashierRow(cashierKey, cashierName) {
  return {
    cashierProfileId: cashierKey,
    cashierName,
    tickets: 0,
    stake: 0,
    open: 0,
    won: 0,
    lost: 0,
    paid: 0,
    cashbackPaid: 0,
  };
}

function emptyDayRow(ymd, dayLabel) {
  return {
    date: ymd,
    dayLabel,
    tickets: 0,
    stake: 0,
    open: 0,
    won: 0,
    lost: 0,
    paid: 0,
    cashbackPaid: 0,
  };
}

function isUnsettledTicketStatus(status) {
  return status === "OPEN" || status === "PRINTED";
}

function resolveCashierKey(ticket) {
  return ticket.cashier_id || ONLINE_CASHIER_KEY;
}

function resolveCashierName(cashierKey, cashierNameById) {
  if (cashierKey === ONLINE_CASHIER_KEY) return "Online / no cashier";
  return cashierNameById.get(cashierKey) || "Cashier";
}

function ensureBranch(branchMap, branchName) {
  const key = branchName || "Unknown";
  let row = branchMap.get(key);
  if (!row) {
    row = emptyBranchRow(key);
    branchMap.set(key, row);
  }
  return row;
}

function ensureCashier(cashierMap, cashierKey, cashierNameById) {
  let row = cashierMap.get(cashierKey);
  if (!row) {
    row = emptyCashierRow(cashierKey, resolveCashierName(cashierKey, cashierNameById));
    cashierMap.set(cashierKey, row);
  }
  return row;
}

/**
 * Build sales report buckets: sold tickets by created_at, paid by paid_at.
 *
 * @param {{
 *   soldTickets: Array<{ cashier_id?: string|null, branch_name?: string|null, stake?: number, status?: string, created_at: Date }>,
 *   paidTickets: Array<{ cashier_id?: string|null, branch_name?: string|null, status?: string, paid_at: Date }>,
 *   start: Date,
 *   daySpan: number,
 *   getDayLabel: (d: Date) => string,
 *   cashierNameById?: Map<string, string>,
 * }} p
 */
export function buildSalesReportAggregates({
  soldTickets,
  paidTickets,
  start,
  daySpan,
  getDayLabel,
  cashierNameById = new Map(),
}) {
  const dailyMap = new Map();
  for (let i = 0; i < daySpan; i += 1) {
    const d = new Date(start.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    const ymd = d.toISOString().slice(0, 10);
    dailyMap.set(ymd, emptyDayRow(ymd, getDayLabel(d)));
  }

  const branchMap = new Map();
  const cashierMap = new Map();

  for (const ticket of soldTickets) {
    const stake = Number(ticket.stake || 0);
    const ymd = ymdUtc(ticket.created_at);
    const dayRow = ymd ? dailyMap.get(ymd) : null;
    if (dayRow) {
      dayRow.tickets += 1;
      dayRow.stake += stake;
      if (isUnsettledTicketStatus(ticket.status)) dayRow.open += 1;
      if (ticket.status === "WON") dayRow.won += 1;
      if (ticket.status === "LOST") dayRow.lost += 1;
    }

    const branchRow = ensureBranch(branchMap, ticket.branch_name);
    branchRow.tickets += 1;
    branchRow.stake += stake;
    if (isUnsettledTicketStatus(ticket.status)) branchRow.open += 1;
    if (ticket.status === "WON") branchRow.won += 1;
    if (ticket.status === "LOST") branchRow.lost += 1;

    const cashierKey = resolveCashierKey(ticket);
    const cashierRow = ensureCashier(cashierMap, cashierKey, cashierNameById);
    cashierRow.tickets += 1;
    cashierRow.stake += stake;
    if (isUnsettledTicketStatus(ticket.status)) cashierRow.open += 1;
    if (ticket.status === "WON") cashierRow.won += 1;
    if (ticket.status === "LOST") cashierRow.lost += 1;
  }

  for (const ticket of paidTickets) {
    const ymd = ymdUtc(ticket.paid_at);
    const dayRow = ymd ? dailyMap.get(ymd) : null;
    const isCashback = ticket.status === "CASHBACK_PAID";
    if (dayRow) {
      if (isCashback) dayRow.cashbackPaid += 1;
      else dayRow.paid += 1;
    }

    const branchRow = ensureBranch(branchMap, ticket.branch_name);
    if (isCashback) branchRow.cashbackPaid += 1;
    else branchRow.paid += 1;

    const cashierKey = resolveCashierKey(ticket);
    const cashierRow = ensureCashier(cashierMap, cashierKey, cashierNameById);
    if (isCashback) cashierRow.cashbackPaid += 1;
    else cashierRow.paid += 1;
  }

  const totalStake = soldTickets.reduce(
    (sum, ticket) => sum + Number(ticket.stake || 0),
    0,
  );

  return {
    dailyMap,
    branchMap,
    cashierMap,
    totalStake,
    paidTicketsCount: paidTickets.filter((t) => t.status === "PAID").length,
    cashbackPaidTicketsCount: paidTickets.filter(
      (t) => t.status === "CASHBACK_PAID",
    ).length,
  };
}

/**
 * Agent reports: sales by created_at, paid counts by paid_at.
 */
export function applyAgentSaleTicket(ticket, branchRow, cashierRow) {
  const stake = Number(ticket.stake || 0);
  branchRow.tickets += 1;
  branchRow.stake += stake;
  if (isUnsettledTicketStatus(ticket.status)) branchRow.open += 1;
  if (ticket.status === "WON") branchRow.won += 1;
  if (ticket.status === "LOST") branchRow.lost += 1;

  cashierRow.tickets += 1;
  cashierRow.stake += stake;
  if (isUnsettledTicketStatus(ticket.status)) cashierRow.open += 1;
  if (ticket.status === "WON") cashierRow.won += 1;
  if (ticket.status === "LOST") cashierRow.lost += 1;
}

export function applyAgentPaydayTicket(ticket, branchRow, cashierRow) {
  if (ticket.status === "CASHBACK_PAID") return;
  branchRow.paid += 1;
  cashierRow.paid += 1;
}

export function emptyAgentBranchRow(branchName) {
  return {
    branchName,
    tickets: 0,
    stake: 0,
    open: 0,
    won: 0,
    lost: 0,
    paid: 0,
  };
}

export function paidAtFromLedger(ticketId, status, transactions) {
  const refs =
    String(status || "") === "CASHBACK_PAID"
      ? [`cashback-payout:${ticketId}`]
      : [`ticket:${ticketId}`, `win-settlement:${ticketId}`];
  const byRef = new Map(
    (transactions || []).map((tx) => [String(tx.reference || ""), tx]),
  );
  for (const ref of refs) {
    const tx = byRef.get(ref);
    if (tx?.created_at) return tx.created_at;
  }
  return null;
}

export function emptyAgentCashierRow(cashierKey, cashierName) {
  return {
    cashierProfileId: cashierKey,
    cashierName,
    tickets: 0,
    stake: 0,
    open: 0,
    won: 0,
    lost: 0,
    paid: 0,
  };
}
