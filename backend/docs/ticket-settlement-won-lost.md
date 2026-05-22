# How tickets are marked WON or LOST when a game ends

This document describes how **selections (legs)** and **tickets** move from pending to WON/LOST in this codebase. The logic is shared through `services/ticketSettlementService.js` and `services/marketEvaluator.js`; only the **source of truth for the result** differs between API fixtures and admin-managed matches.

## Two game sources, one settlement engine

| Flow | Database link | When the game is considered “ended” | Entry point |
|------|----------------|--------------------------------------|-------------|
| **Regular / API fixture** (prematch or in-play bets on synced fixtures) | `TicketSelection.fixture_id` | `Fixture.status` is **terminal**: finished codes (`FT`, `AET`, `PEN`, `AWD`, `WO`) or void-like codes (`CANC`, `ABD`, `PST`) | `settleFixture(fixtureId)` — usually triggered from `jobs/syncFixtures.js` when a fixture **newly** becomes terminal |
| **Admin “live” match** (manual/virtual matches under admin games) | `TicketSelection.match_id` | Admin applies a result; `Match.status` is set to `FINISHED` and `Match.result` holds the winning label | `settleMatch(matchId, result)` — used by `PATCH /api/admin/games/matches/:id/result` (`overrideMatchResult` in `controllers/gameController.js`) |

Parlays work the same for both: each leg is a `TicketSelection` row; the ticket is recomputed from all legs.

## Step 1 — Grade each leg (`TicketSelection.result`)

Settlement loads all selections tied to that fixture or match. For each selection whose `result` is still `PENDING`:

1. **`marketEvaluator.evaluateSelection`** runs with a normalized **`matchResult`** object:
   - **Fixtures**: built from `Fixture` — `home_score`, `away_score`, whether the fixture is **finalized** vs **voided** (from status), etc. (`buildFixtureMatchResult`).
   - **Matches**: built from `Match` — `finalized` is true when `status === "FINISHED"`; optional `result` string for legacy/admin labeling (`buildMatchMatchResult`).
2. The evaluator returns `WON`, `LOST`, `VOID`, or leaves **`PENDING`** (e.g. match not finalized, unknown market, missing scores).

Only **PENDING** legs are overwritten; legs already graded stay frozen.

## Step 2 — Set ticket status (`OPEN` / `PRINTED` → `WON` / `LOST`)

**`recomputeTicketStatus`** applies the canonical rules (same for fixtures and admin matches):

1. If the ticket is not in `OPEN` or `PRINTED`, it is not changed here (e.g. already `PAID`, `VOID`, `CASHED_OUT`).
2. If **any** leg is `LOST` → ticket becomes **`LOST`** (takes precedence).
3. Else if **every** leg is resolved (`WON` or `VOID`, none still `PENDING`) → ticket becomes **`WON`**.
4. Else → ticket **stays** as `OPEN` or `PRINTED` until another leg’s game finishes.

When the ticket moves to `WON` or `LOST`, **`total_odds`** and **`potential_win`** are recalculated: `VOID` legs contribute a **1.0** multiplier; `LOST` forces **`potential_win`** to **0**.

## Regular games vs “live” updates (API fixtures only)

- **`jobs/syncLiveFixtures.js`** refreshes scores, in-play status, and odds for fixtures currently in the provider’s **live** list. It **does not** call `settleFixture`.
- **Final** scores and terminal statuses (e.g. `FT`) are delivered through the **date-based** fixture sync (`jobs/syncFixtures.js`). When a row **first** transitions into a terminal status, that job calls **`settleFixture`**, which is idempotent using `Fixture.settled_at`.

So for API-backed betting: “live” is a **phase** of the same `Fixture` row; **settlement** still runs when the fixture is seen as **finished/void** on the bulk sync path (not from the live poller).

## Admin live matches

Admin UI can set match lifecycle (`NOT_STARTED`, `LIVE`, `SUSPENDED`, `FINISHED`) separately from settlement. **Grading and ticket WON/LOST** run when **`settleMatch`** is invoked with a **result** (the override endpoint). That function sets the match to **`FINISHED`**, grades `match_id` selections—using structured markets when `market_code` is known, otherwise comparing a stored **result string** to the selection label in a legacy path—and then applies the same ticket recomputation and payout rules as fixtures.

## After WON — payouts

- **Player (online) tickets** with no cashier print transaction: after `WON`, **`creditOnlineWinnerInTx`** credits the player wallet and moves the ticket to **`PAID`** (idempotent via transaction reference `win-settlement:<ticketId>`).
- **Cashier-printed** tickets: wallet auto-credit is skipped; they remain **`WON`** until the cashier **`payoutTicket`** flow runs.

## Quick reference — key files

| Concern | File |
|---------|------|
| Fixture settlement & ticket recompute | `backend/services/ticketSettlementService.js` |
| Per-market leg grading | `backend/services/marketEvaluator.js` |
| Trigger: API fixture terminal | `backend/jobs/syncFixtures.js` (`safeSettleFixture`) |
| Trigger: admin match result | `backend/controllers/gameController.js` (`overrideMatchResult`) |
| Live score/odds refresh (no settlement) | `backend/jobs/syncLiveFixtures.js` |
