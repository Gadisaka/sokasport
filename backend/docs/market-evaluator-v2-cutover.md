# Market Evaluator V2 — Cutover Checklist

Runbook for moving the production settlement engine from V1 to V2 with
zero downtime and a rollback lever at every step.

## Phase 0 — Pre-flight (no production changes)

- [ ] All V2 tests pass locally (`npm run test:evaluator`,
      `npm run test:markets`, `npm test`).
- [ ] `prisma db push` against a staging MongoDB (adds the new
      `Fixture.ht_home_score`, `Fixture.grading_completed_at`,
      `Fixture.events_payload`, `Fixture.stats_payload`,
      `Fixture.result_version`, `Fixture.result_hash`,
      `Fixture.finality`, `Match.ht_home_score`, `Match.events_payload`,
      `TicketSelection.result_meta`, `TicketSelection.market_version`,
      and **`Transaction.reference @unique`** columns / indexes).
- [ ] Run the reference backfill in **dry-run** first:
      `node backend/scripts/backfillReferences.js` (inspect the count).
- [ ] Apply the backfill: `npm run settlement:backfill-references`
      (idempotent; safe to re-run).
- [ ] Deploy backend **with `SETTLEMENT_ENGINE` unset** — nothing
      changes for end users; V1 continues to own grading.

## Phase 1 — Shadow mode (read-only validation)

- [ ] Set `SETTLEMENT_ENGINE_SHADOW=v2` on the worker and API.
- [ ] Restart workers. Settlement still returns V1 outcomes; V2 grades
      every leg in parallel. Any disagreement writes
      `SETTLEMENT_SHADOW_MISMATCH` to `AuditLog`.
- [ ] After 24 hours, run
      `npm run settlement:shadow-report -- --hours 24`. Target: **0**
      mismatches on basic markets (`MATCH_WINNER`, `OVER_UNDER`,
      `DOUBLE_CHANCE`, `DRAW_NO_BET`, `BTTS`, `ODD_EVEN`).
- [ ] Enable enrichment for events/stats by setting
      `ENABLE_FIXTURE_ENRICHMENT=1`. Re-run shadow report after 24h;
      event-based markets (`GOALSCORER_*`, `PLAYER_CARDS`,
      `CARDS_OVER_UNDER`) should now grade cleanly.
- [ ] Do not proceed until the shadow report is either empty or every
      mismatch has a documented explanation (e.g. V2 fixed a known V1
      bug in correct-score grading).

## Phase 2 — Placement-time validation

- [ ] Set `PLACEMENT_VALIDATION=v2` on the API (NOT the worker). This
      makes `POST /api/tickets` and `POST /api/bets/place` route every
      new selection through `MARKET_REGISTRY.validate(...)`. Invalid
      selections are rejected with a structured 400.
- [ ] Watch frontend logs for `invalid_selections`. Each entry gives
      the canonical error code (`invalid_line`, `missing_player_id`,
      `unknown_market`) which the UI can surface.
- [ ] Shadow mode continues running — settlement is still V1-owned
      and still guarded.

## Phase 3 — V2 cutover

- [ ] Keep `SETTLEMENT_ENGINE_SHADOW=v2`.
- [ ] Set `SETTLEMENT_ENGINE=v2` on the worker. Restart. V2 now owns
      every leg outcome; shadow continues writing V1 as the comparison
      side.
- [ ] Monitor `Ticket.status` transitions for 24h. Key metrics:
      - WON / LOST / VOID rates vs the previous 7-day baseline,
      - player wallet credit volume (PAYOUT transactions),
      - `bet-refund:` transactions (new — all-VOID tickets).
- [ ] Check the shadow report again — now V2 is the live outcome. A
      mismatch here means V1 would have graded differently, which is
      the very thing V2 fixes. Spot-check a handful.

## Phase 4 — Decommission V1

- [ ] Remove the `SETTLEMENT_ENGINE_SHADOW` env var (saves one leg of
      graded work per selection).
- [ ] After 2 more weeks of clean operation, delete
      `backend/services/marketEvaluator.js`, the `inferMarketCode`
      import in `controllers/ticketsController.js`, and the
      `buildV1*MatchResult` helpers in `ticketSettlementService.js`.
- [ ] Bump the `MATCH_RESULT_SCHEMA_VERSION` if any new fields are
      added during the freeze.

## Rollback

- **Placement**: unset `PLACEMENT_VALIDATION` → legacy `inferMarketCode`
  path reactivates on the next process restart.
- **Settlement**: unset `SETTLEMENT_ENGINE` → V1 owns grading again.
  `TicketSelection.result_meta.shadow.result` retains the V2 verdict
  for forensic comparison.
- Neither rollback requires a DB migration. The new columns are
  nullable and ignored by V1 code paths.

## Observability additions

Look for these log lines to know V2 is working:

```text
[settlement] engine=v2 shadow=v1 selectionsUpdated=…
[matchResult/v2] inconsistent_payload source=FIXTURE id=… reason=… — downgraded finality to PENDING
[settlementRetry] scanned=… retried=… completed=… stillPending=…
[enrichFixtureResult] events=… haveStats=true
```

## Data-safety invariants (must always hold)

1. `Transaction.reference` is unique. Every financial write supplies it.
2. A ticket is WON only after `creditOnlineWinnerInTx` has recorded a
   `win-settlement:<ticketId>` transaction — or the ticket was
   cashier-printed and waiting for `payoutTicket`.
3. A ticket is VOID only after `refundOnlineTicketInTx` has recorded a
   `bet-refund:<ticketId>` transaction — or no refund was owed
   (cashier flow).
4. `Fixture.grading_completed_at` is only set when every associated
   leg has left the `PENDING` state. The settlement-retry job depends
   on this invariant.
5. The V2 engine returns `PENDING` if and only if
   `MatchResultV2.finality === "PENDING"`.
