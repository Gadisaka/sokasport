# Settlement stuck on completed fixtures — event/score mismatch downgraded the WHOLE fixture to PENDING

**Status:** Fixed (2026-06-17)
**Affected area:** Settlement engine V2 — `services/matchResult/v2.js` (`detectInconsistency` handling in `buildMatchResultV2FromFixture`).
**Symptom:** Tickets on **already-finished** games never settle. The fixture shows as terminal (`FT`) with a correct final score, yet score-only legs (Match Winner, Double Chance, Over/Under, BTTS) stay `PENDING` forever. In the admin fixture-ops page these fixtures read as "stuck". After ~6h they emit `SETTLEMENT_STUCK_CRITICAL` in the worker log.

---

## Executive summary

The V2 result builder runs a consistency check (`detectInconsistency`) on every FINAL fixture: it counts the goal **events** and asserts they tally to the final **score**. When they don't match, the old code downgraded the **entire fixture** to `finality = "PENDING"`.

That is too aggressive. A mismatch between events and score means **the event feed is unreliable** — it does **not** mean the score is wrong. The final score (`goals` / `score.fulltime` on a terminal fixture) is the authoritative field. Downgrading the whole fixture stranded every market on it — including markets that only read the score and never look at events.

Two independent real-world triggers produced the same hang:

1. **Sparse / incomplete event feed** (lower leagues). Example: API-Football fixture `1524947` (USL League Two, West Chester United 3–1 Lone Star II, status `FT`) returned a **correct 3–1 score** but only **ONE goal event**. Tally `1-0` vs score `3-1` → mismatch → whole fixture PENDING → the `Double Chance: 1X` leg (West Chester won, plainly WON) never settled.
2. **Own goals** (e.g. World Cup group games with an own goal). The own-goal credited-team flip can leave the event tally off-by-one against the score → same whole-fixture PENDING → Match Winner legs stuck even though the score was correct.

**The fix:** on an event/score mismatch, keep the fixture `FINAL` (trust the score) and **null only the events**. Score-derived markets settle normally; event-derived markets (goalscorer, correct-score-by-events) fail `canEvaluate()` and VOID/refund — the correct fail-closed outcome. The full PENDING downgrade is now reserved for the one case that genuinely can't be graded: a terminal fixture with **no usable score** (`final_without_scores`).

This bug and fix are generic to any settlement engine that cross-checks goal events against the final score.

---

## Background: how a fixture becomes settleable in V2

1. `jobs/syncFixtures.js` upserts fixtures from API-Football. When a row first transitions to a terminal status it calls `settleFixture` (and `jobs/settlementRetry.js` retries every 5 min for anything left pending).
2. `services/ticketSettlementService.js` builds a canonical `MatchResultV2` via `buildMatchResultV2FromFixture(fixture)` and grades each leg.
3. `services/matchResult/v2.js` (`buildMatchResultV2FromFixture`) normalizes scores + events + stats and stamps `finality` (`FINAL` / `AWARDED` / `VOID` / `PENDING`).
4. A leg only leaves `PENDING` once the fixture is gradeable. A fixture is marked fully settled (`grading_completed_at`) only when **every** leg is non-pending. **One stuck leg keeps the whole ticket (and fixture) open.**

`finality = "PENDING"` from the builder forces **every** grader to return PENDING — that is the mechanism that strands score-only markets.

---

## Root cause — [backend/services/matchResult/v2.js](../backend/services/matchResult/v2.js)

`detectInconsistency(payload)` (unchanged) returns:
- `"final_without_scores"` — terminal fixture but `home`/`away` score is not an integer.
- `"score_event_mismatch:H-A_vs_H-A"` — goal events present but they don't tally to the score (counted by **credited** team, so own goals are flipped to the beneficiary).
- `null` — consistent, or no events provided (then the score is trusted as-is).

The **old** handling treated both non-null reasons identically:

```js
const inconsistency = detectInconsistency(payload);
if (inconsistency) {
  payload.finality = "PENDING";   // <-- nukes EVERY market on the fixture
  logInconsistency("FIXTURE", fixture.id ?? fixture.api_fixture_id, inconsistency);
}
```

So a fixture with a perfectly good 3–1 score but a one-event feed (or an own-goal tally off by one) had **all** its markets downgraded to PENDING, including Match Winner / Double Chance / O/U / BTTS that never read events.

### Why it surfaced now

- Lower-league feeds (USL League Two, state leagues) routinely report the correct score but an incomplete event timeline → `score_event_mismatch`.
- Own-goal matches (more visible during the World Cup) hit the credited-team tally edge → same mismatch.
- High-profile games that settled fine on the same ticket had **complete, consistent** event feeds and passed the check — which is exactly why the failure looked random/per-fixture rather than per-league.

---

## The fix

### [backend/services/matchResult/v2.js](../backend/services/matchResult/v2.js) — scoped downgrade

```js
const inconsistency = detectInconsistency(payload);
if (inconsistency === "final_without_scores") {
  // No usable final score on a terminal fixture — nothing can be graded yet.
  // Downgrade to PENDING so a retry settles it once the score lands.
  payload.finality = "PENDING";
  logInconsistency("FIXTURE", fixture.id ?? fixture.api_fixture_id, inconsistency);
} else if (inconsistency) {
  // Score is present and trusted, but the goal EVENTS don't reconcile to it
  // (sparse/incomplete feed, own-goal mis-attribution, late VAR edit). On a
  // terminal fixture the SCORE is authoritative, so we keep finality FINAL —
  // score-derived markets (match winner, double chance, O/U, BTTS, handicaps,
  // totals) settle normally. We distrust only the events: null them so
  // event-derived markets (goalscorer, correct-score-by-events) fail
  // canEvaluate() and VOID/refund instead of grading against a broken feed.
  payload.events = null;
  logInconsistency("FIXTURE", fixture.id ?? fixture.api_fixture_id, inconsistency);
}
```

Behavior after the fix:

| Situation | finality | events | Score-only markets | Event markets |
|---|---|---|---|---|
| Consistent feed | FINAL | kept | settle | settle |
| Events ≠ score (sparse feed / own-goal tally) | **FINAL** | **null** | **settle** | VOID/refund |
| Terminal but no valid score | PENDING | n/a | wait (retry) | wait (retry) |
| Cancelled / postponed (`CANC`/`ABD`/`PST`) | VOID | n/a | VOID/refund | VOID/refund |

Note: `events = null` (not `[]`). The presence gate in V2 treats `null` as "events not trustworthy" so event-derived graders return VOID via `canEvaluate()`. An empty array `[]` would be read as "enriched, genuinely zero events" and could mis-grade — so `null` is required.

### [backend/tests/matchResult/v2.test.js](../backend/tests/matchResult/v2.test.js) — tests

- Replaced the old `"inconsistent events → PENDING"` test with `"inconsistent events → stays FINAL, events nulled"` (3–1 score, one event): asserts `finality === "FINAL"`, scores preserved, `events === null`.
- Added `"terminal fixture WITHOUT a usable score → PENDING"` to lock the `final_without_scores` branch.

---

## How to verify on a real fixture (API-Football)

The mismatch is visible directly from the provider. Two endpoints, header `x-apisports-key: <key>`:

```
GET https://v3.football.api-sports.io/fixtures?id=1524947
GET https://v3.football.api-sports.io/fixtures/events?fixture=1524947
```

For `1524947` the score is `3-1` (`FT`) but `/fixtures/events` returns a single goal event → the old engine downgraded to PENDING; the new engine keeps it FINAL and settles the score-only legs.

A diagnostic helper is checked in at [backend/scripts/diagFixture.mjs](../backend/scripts/diagFixture.mjs):

```
node scripts/diagFixture.mjs 1524947
```

It prints the score, every goal event, and two tallies (raw `event.team` vs own-goal-credited) against the final score, so you can see which fixtures would trip `detectInconsistency`.

---

## Production evidence (ticket kx092775)

A real stuck coupon confirmed the diagnosis. Querying its legs against the DB:

```
[PENDING] MATCH_WINNER "2"   apiFx=1539016 status=FT score=1-4 settled=true graded=false ver=1   (Iraq v Norway, away won → "2" = WON)
[PENDING] MATCH_WINNER "1"   apiFx=1489382 status=FT score=3-1 settled=true graded=false ver=1   (Austria v Jordan, home won → "1" = WON)
[PENDING] DOUBLE_CHANCE "1X" apiFx=1524947 status=FT score=3-1 settled=true graded=false ver=1   (West Chester, home won → "1X" = WON)
[VOID]    OVER_UNDER "OVER 2.5" apiFx=1524039 status=PST score=null-null graded=true ver=0       (postponed → already VOID, correct)
... 10 other legs all WON / graded=true
```

Every stuck leg is **`status=FT` + `settled=true` + `ver=1`** (terminal, settlement ran, events enriched) with a **valid score that plainly makes the pick WON** — yet **`graded=false`**. That is exactly the `detectInconsistency` whole-fixture-PENDING downgrade: the two World Cup games have **own goals**, and `1524947` has the **sparse single-event feed**. The `PST` leg already voids correctly. This is the canonical signature of the bug: *terminal + settled + valid score + a score-only market still PENDING.*

> Note: the result **did** sync (`status=FT`). An earlier hypothesis ("the result never reached the DB / league rank-cap gap") was **disproven** by this data — the rows are terminal with scores. The block was purely the inconsistency downgrade.

## Settling the existing stuck tickets after deploy

The fixtures are already terminal with valid scores, so once the fix is deployed they grade immediately. No data backfill needed.

**Deploy the fix FIRST.** `settleFixture` rebuilds the result via `buildMatchResultV2FromFixture`, which runs `detectInconsistency`. On the OLD code that still downgrades to PENDING — so re-settling before deploy just re-sticks them. Ship the `v2.js` change, confirm the new image is live, then re-settle.

1. **Deploy** the V2 change (backend + worker — they share the image).
2. **Targeted re-settle** of the known stuck fixtures (also recomputes + pays the ticket; idempotent):
   ```
   docker compose -f docker-compose.prod.yml exec backend node -e '
   import("./services/ticketSettlementService.js").then(async (m)=>{
     const {prisma}=await import("./Config/db.js");
     const ids=[1539016,1489382,1524947];           // api_fixture_ids
     for(const apiId of ids){
       const f=await prisma.fixture.findFirst({where:{api_fixture_id:apiId},select:{id:true}});
       if(!f){console.log(apiId,"no row");continue;}
       const r=await m.settleFixture(f.id,{force:true});
       console.log(apiId,"->",JSON.stringify({graded:r.gradingCompleted,pending:r.pendingLegsRemaining,won:r.ticketsWon,payouts:r.payoutsCredited}));
     }
     process.exit(0);
   });'
   ```
   Expected: each fixture `graded:true, pending:0`; the ticket flips WON and pays out (PST odd excluded) when its last pending leg clears.
3. **Or** let the `settlement-retry` job drain the whole backlog (runs every 5 min), or trigger it once:
   ```
   docker compose -f docker-compose.prod.yml exec backend \
     node -e "import('./jobs/settlementRetry.js').then(m=>m.runSettlementRetry()).then(r=>{console.log(r);process.exit(0)})"
   ```

### Note on the retry job (no bug)

During the incident an early `runSettlementRetry()` returned `scanned=0`. This was **not** a retry-job bug: it ran *before* the fix was deployed, and by the time it ran the fixtures were not yet in the "terminal + pending" backlog state it scans. After deploy, the worker's normal settlement pass graded the fixtures on its own (the manual `force` re-settle then found nothing left to do — `selectionsUpdated=0`, idempotent no-op). The `start_time` values were valid and recent, so the `start_time: { gte: now-14d }` window was never the problem. The retry net works as designed.

### Log-message correctness

`logInconsistency()` previously always printed `"downgraded finality to PENDING"`, even on the new events-distrusted path that keeps `FINAL`. That was misleading in the worker log. The message now reflects the actual action taken:

- no usable score → `inconsistent_payload ... — downgraded finality to PENDING (no usable score)`
- event/score mismatch → `inconsistent_payload ... — events distrusted (nulled); score kept, finality stays FINAL`

When you see the second message in prod, that is the **healthy** path: score-only markets settled, only the unreliable event feed was discarded.

### The POSTPONED leg needs NO special handling

Coupon kx092775 also held a postponed fixture (`apiFx=1524039`, `status=PST`). The query confirmed it is **already `[VOID]` and `graded=true`** — the engine handles it correctly with no intervention:

- `PST` maps to `finality = "VOID"` (`VOID_STATUSES` in `v2.js`) → that leg grades **VOID**.
- In `recomputeTicketStatus` (`ticketSettlementService.js`) a VOID leg collapses to a **1.0 multiplier** (`legMultiplier`) → removed from the odds product. The postponed game's odd is **excluded from the payout automatically**.
- The ticket finalizes once **all** legs are non-pending. The only thing blocking kx092775 was the three stuck score-only legs from this bug.

So after the targeted re-settle (step 2 above), the three legs grade WON, the `PST` leg stays VOID, no leg is LOST → **ticket settles WON** and pays out on the product of the non-void legs.

> Recompute rules: any LOST leg → ticket LOST; else all non-pending → WON on the non-void product; all-VOID → VOID + full refund.
> Idempotency: re-running settlement is safe. Wallet credit/refund use unique transaction references (`win-settlement:<ticketId>`, `bet-refund:<ticketId>`), so a fixture can be re-settled without double-paying.

---

## Files changed

| File | Change |
|---|---|
| `backend/services/matchResult/v2.js` | Scoped the `detectInconsistency` handling: `final_without_scores` → PENDING; any other mismatch → keep `FINAL`, set `events = null`. |
| `backend/tests/matchResult/v2.test.js` | Updated the inconsistency test to assert FINAL + nulled events; added a `final_without_scores → PENDING` test. |
| `backend/scripts/diagFixture.mjs` | New one-off diagnostic: dumps score + goal events + raw/credited tallies for a fixture id. |

No schema change. No env change. Backend + worker deploy only.

---

## Porting this fix to another project

The other betting site shares this settlement architecture. To apply:

1. Open its equivalent of `services/matchResult/v2.js` and find where `detectInconsistency` (or any "goal events must equal the score" check) sets `finality = "PENDING"`.
2. Replace the blanket downgrade with the scoped version above:
   - keep the PENDING downgrade **only** for the missing/invalid-score case,
   - for an events-vs-score mismatch, keep `finality = "FINAL"` and set `events = null` (null, not `[]`).
3. Confirm event-derived graders treat `events = null` as "cannot evaluate → VOID" (presence gate), not as "zero events".
4. Mirror the two test changes.
5. After deploy, run the settlement-retry/backfill so already-finished fixtures with sparse or own-goal feeds settle their score-only legs.

### Related / recommended follow-ups (not included here)

- **Open-bet fixtures must always ingest their result regardless of league rank cap** (`INGEST_ACTIVE_CAP`). A fixture with money on it should never be skipped by the result sync. (Separate change in `jobs/syncFixtures.js`.)
- **Age-based VOID for genuinely ungradable stat markets**: a terminal fixture whose stat data never arrives stays PENDING forever (corners/cards/etc. demoted to "awaiting_enrichment"). Add a staleness cutoff (e.g. reuse `SETTLEMENT_STUCK_CRITICAL_HOURS`) after which missing-data legs VOID/refund instead of hanging. (Separate change in `ticketSettlementService.js`.)
