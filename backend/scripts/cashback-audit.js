// Read-only cashback eligibility audit. Replicates evaluateCashback against
// live LOST / CASHBACK_PAID tickets to bucket denial reasons.
// Run: docker exec -i <mongo> mongosh "<url>" --quiet < cashback-audit.js

const bonus = db.bonuses.findOne({ type: "CASHBACK" });
const rules = bonus.rules || {};
const profiles = Array.isArray(rules.profiles) ? rules.profiles : [];
const v2Tiers = rules.tiers || [];
const isV3 = profiles.length > 0;
const minSelections = Number(rules.minSelections ?? 0);
const minStake = Number(rules.minStake ?? 0);
const maxHours = Number(rules.maxHours ?? 0);
const minResult = Number(rules.minResult ?? 0);
const excludeLive = rules.excludeLiveForOnline !== false;
const fixtureDq = new Set(rules.disqualifyFixtureStatuses || ["PST", "CANC", "ABD"]);
const matchDq = new Set(rules.disqualifyMatchStatuses || ["SUSPENDED"]);

function exactTier(r, tiers) {
  for (const t of tiers) {
    const max = t.maxResult == null ? Infinity : t.maxResult;
    if (r >= t.minResult && r <= max) return t;
  }
  return null;
}
function thresholdTier(r, tiers) {
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

  const lost = sels.filter((s) => s.result === "LOST" && Number(s.odds) > 0);
  if (!lost.length) { bump(kind + ":no_lost_leg"); continue; }

  let profile = null;
  let profileKey = null;
  let tiers = v2Tiers;
  let profileMinResult = minResult;
  let profileMinStake = minStake;

  if (isV3) {
    profile = profiles.find((p) => Number(p.lostLegs) === lost.length);
    if (!profile) {
      bump(kind + (lost.length >= 3 ? ":too_many_lost_legs" : ":no_matching_profile"));
      continue;
    }
    profileKey = profile.key || (lost.length === 1 ? "oneLoss" : "twoLoss");
    tiers = profile.tiers || [];
    profileMinResult = Number(profile.minResult ?? 0);
    profileMinStake = Number(printed ? (profile.minStakeOffline ?? 0) : (profile.minStakeOnline ?? 0));

    if (sels.length < Number(profile.minLegs ?? 0)) {
      bump(kind + ":" + profileKey + ":too_few_selections");
      continue;
    }
    const minLegOdds = Number(profile.minLegOdds ?? 0);
    if (minLegOdds > 0 && sels.some((s) => !(Number(s.odds) > minLegOdds))) {
      bump(kind + ":" + profileKey + ":leg_odds_below_min");
      continue;
    }
  } else {
    if (!(sels.length > minSelections)) { bump(kind + ":too_few_selections"); continue; }
  }

  if (Number(t.stake) < profileMinStake) {
    bump(kind + (profileKey ? ":" + profileKey : "") + ":below_min_stake");
    continue;
  }

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

  if (isV3 && !printed && excludeLive) {
    const live =
      String(t.channel || "").toUpperCase() === "LIVE" ||
      sels.some((s) => s.live_at_placement === true);
    if (live) { bump(kind + ":" + profileKey + ":live_leg_excluded"); continue; }
  }

  const lostOddsSum = isV3
    ? lost.reduce((a, s) => a + Number(s.odds), 0)
    : Math.max(...lost.map((s) => Number(s.odds)));
  if (!(lostOddsSum > 0)) { bump(kind + ":no_lost_leg"); continue; }

  const current = Number(t.total_odds);
  const placement = sels.reduce((a, s) => a * (Number(s.odds) || 1), 1);
  const hasVoid = sels.some((s) => s.result === "VOID");
  if (hasVoid && Math.abs(placement - current) / placement > 0.01) oddsRewriteCases++;

  const rCur = current / lostOddsSum;
  const rPlace = placement / lostOddsSum;

  if (rCur < profileMinResult) {
    bump(kind + (profileKey ? ":" + profileKey : "") + ":below_min_result");
    continue;
  }

  const tCur = exactTier(rCur, tiers);
  const tThresh = thresholdTier(rCur, tiers);
  const tPlace = exactTier(rPlace, tiers) || thresholdTier(rPlace, tiers);

  if (!tCur) {
    bump(kind + (profileKey ? ":" + profileKey : "") + ":no_matching_tier(GAP)");
    gapCases++;
    if (tThresh) gapMoney += t.stake * tThresh.stakeMultiplier;
    if (samples.length < 12) {
      samples.push({
        receipt: t.receipt_number, kind, profile: profileKey, paid, stake: t.stake,
        legs: sels.length, lostLegs: lost.length, totalOdds: current,
        lostOdds: lostOddsSum, ratio: Number(rCur.toFixed(3)),
        wouldPay: tThresh ? t.stake * tThresh.stakeMultiplier : 0,
      });
    }
    continue;
  }

  if (tPlace && tPlace.stakeMultiplier > tCur.stakeMultiplier) {
    tierDowngrades++;
    downgradeMoney += t.stake * (tPlace.stakeMultiplier - tCur.stakeMultiplier);
  }

  bump(kind + (profileKey ? ":" + profileKey : "") + ":eligible" + (paid ? "(paid)" : "(unclaimed)"));
}

print("=== tickets scanned (last 60d, LOST/CASHBACK_PAID) === " + tickets.length);
print("=== rules version === " + (isV3 ? "v3-profiles" : "v2-single-track"));
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
