// Read-only cashback eligibility audit. Replicates evaluateCashback against
// live LOST / CASHBACK_PAID tickets to bucket denial reasons.
// Run: docker exec -i <mongo> mongosh "<url>" --quiet < cashback-audit.js

const bonus = db.bonuses.findOne({ type: "CASHBACK" });
const rules = bonus.rules || {};
const tiers = rules.tiers || [];
const minSelections = Number(rules.minSelections ?? 0);
const minStake = Number(rules.minStake ?? 0);
const maxHours = Number(rules.maxHours ?? 0);
const minResult = Number(rules.minResult ?? 0);
const fixtureDq = new Set(rules.disqualifyFixtureStatuses || []);
const matchDq = new Set(rules.disqualifyMatchStatuses || []);

function exactTier(r) {
  for (const t of tiers) {
    const max = t.maxResult == null ? Infinity : t.maxResult;
    if (r >= t.minResult && r <= max) return t;
  }
  return null;
}
function thresholdTier(r) {
  let best = null;
  for (const t of tiers) {
    if (r >= t.minResult && (!best || t.minResult > best.minResult)) best = t;
  }
  return best;
}

const since = new Date(Date.now() - 60 * 24 * 3600 * 1000);
const tickets = db.tickets
  .find({ status: { $in: ["LOST", "CASHBACK_PAID"] }, created_at: { $gte: since } })
  .toArray();

const buckets = {};
const bump = (k) => (buckets[k] = (buckets[k] || 0) + 1);
let gapCases = 0;
let gapMoney = 0;
let oddsRewriteCases = 0;
let tierDowngrades = 0;
let downgradeMoney = 0;
let pendingLegCases = 0;
const samples = [];

for (const t of tickets) {
  const sels = db.ticket_selections.find({ ticket_id: t._id }).toArray();
  const printed = !!db.transactions.findOne({ type: "BET", reference: "ticket-print:" + t._id });
  const paid = !!db.transactions.findOne({ reference: "cashback-payout:" + t._id });
  const kind = printed ? "printed" : "online";

  if (!sels.length) { bump(kind + ":no_selections"); continue; }

  const pending = sels.filter((s) => s.result === "PENDING").length;
  if (pending) pendingLegCases++;

  if (Number(t.stake) < minStake) { bump(kind + ":below_min_stake"); continue; }
  if (!(sels.length > minSelections)) { bump(kind + ":too_few_selections"); continue; }

  if (maxHours > 0) {
    const hrs = (Date.now() - new Date(t.created_at).getTime()) / 3600000;
    if (hrs > maxHours) { bump(kind + ":outside_time_window_now"); continue; }
  }

  const fxIds = [...new Set(sels.map((s) => s.fixture_id).filter(Boolean))];
  const mIds = [...new Set(sels.map((s) => s.match_id).filter(Boolean))];
  const fxs = fxIds.length ? db.fixtures.find({ _id: { $in: fxIds } }, { status: 1 }).toArray() : [];
  const ms = mIds.length ? db.matches.find({ _id: { $in: mIds } }, { status: 1 }).toArray() : [];
  if (fxs.some((f) => fixtureDq.has(f.status)) || ms.some((m) => matchDq.has(m.status))) {
    bump(kind + ":disqualified_selection");
    continue;
  }

  let largestLost = 0;
  for (const s of sels) if (s.result === "LOST" && s.odds > largestLost) largestLost = s.odds;
  if (largestLost <= 0) { bump(kind + ":no_lost_leg"); continue; }

  const current = Number(t.total_odds);
  const placement = sels.reduce((a, s) => a * (Number(s.odds) || 1), 1);
  const hasVoid = sels.some((s) => s.result === "VOID");
  if (hasVoid && Math.abs(placement - current) / placement > 0.01) oddsRewriteCases++;

  const rCur = current / largestLost;
  const rPlace = placement / largestLost;

  if (rCur < minResult) { bump(kind + ":below_min_result"); continue; }

  const tCur = exactTier(rCur);
  const tThresh = thresholdTier(rCur);
  const tPlace = exactTier(rPlace) || thresholdTier(rPlace);

  if (!tCur) {
    bump(kind + ":no_matching_tier(GAP)");
    gapCases++;
    if (tThresh) gapMoney += t.stake * tThresh.stakeMultiplier;
    if (samples.length < 12) {
      samples.push({
        receipt: t.receipt_number, kind, paid, stake: t.stake,
        legs: sels.length, totalOdds: current, lostOdds: largestLost,
        ratio: Number(rCur.toFixed(3)), wouldPay: tThresh ? t.stake * tThresh.stakeMultiplier : 0,
      });
    }
    continue;
  }

  if (tPlace && tPlace.stakeMultiplier > tCur.stakeMultiplier) {
    tierDowngrades++;
    downgradeMoney += t.stake * (tPlace.stakeMultiplier - tCur.stakeMultiplier);
  }

  bump(kind + ":eligible" + (paid ? "(paid)" : "(unclaimed)"));
}

print("=== tickets scanned (last 60d, LOST/CASHBACK_PAID) === " + tickets.length);
print("=== outcome buckets ===");
printjson(buckets);
print("=== bug impact ===");
printjson({
  tier_gap_denials: gapCases,
  tier_gap_money_owed: Math.round(gapMoney * 100) / 100,
  void_rewrote_total_odds: oddsRewriteCases,
  tier_downgraded_by_odds_rewrite: tierDowngrades,
  downgrade_money_owed: Math.round(downgradeMoney * 100) / 100,
  tickets_lost_with_pending_legs: pendingLegCases,
});
print("=== gap samples ===");
printjson(samples);
