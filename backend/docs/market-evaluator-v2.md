# Market Evaluator V2 — Production Design

A complete redesign of the betting settlement engine for the Sokasport
sportsbook, replacing the ad-hoc handler set in
`backend/services/marketEvaluator.js` and tightening the integration
with `backend/services/ticketSettlementService.js`.

## 1. Overview

`marketEvaluator v2` is a deterministic, modular grading engine for
betting selections. It is a **pure function layer** between two
contracts:

- **In:** a locked `TicketSelection` row (market code, params, label,
  odds) plus a normalized `MatchResultV2` (final scores, HT scores,
  events, status flags).
- **Out:** a strict outcome record `{ result, reason, engineVersion,
marketVersion }` — and **never `PENDING` once the match is in a
  final state**.

### Goals

- **Determinism**: same `(selection, matchResult)` input → identical
  output across nodes and replays.
- **Total coverage**: every market the FE can price has a registered
  handler or is rejected at placement.
- **No stuck tickets** once a fixture is final or void.
- **Audit-safe**: every grade carries `reason`, `engineVersion`, and
  `marketVersion`.
- **Modular**: adding a market is one new file, no editing of the
  engine.
- **Financial safety**: VOID/refund semantics are explicit and
  consistent across markets.

## 2. Core Architecture

| Layer                    | Responsibility                                                                           | Lives in                                       |
| ------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Engine**               | Orchestrates: load module, gate on match state, call `evaluate`, enforce universal rules | `services/marketEvaluatorV2.js`                |
| **Market modules**       | Per-market `validate`, `canEvaluate`, `evaluate`, `settlePolicy`                         | `services/markets/<code>.js`                   |
| **Registry**             | Code → Module lookup, alias resolution, version pinning                                  | `services/markets/registry.js`                 |
| **Result model**         | `MatchResultV2` builders + types                                                         | `services/matchResult/v2.js`                   |
| **Settlement**           | DB transactions, ticket recompute, payouts, idempotency                                  | `services/ticketSettlementService.js`          |
| **Placement validation** | `MARKET_REGISTRY.validate(code, params, ctx)`                                            | called from `controllers/ticketsController.js` |

### Deterministic rules

- Every module is a **pure function** of `(selection, matchResult)`.
- No I/O, no `Date.now()`, no `Math.random()` in grading paths.
- `MatchResultV2` is normalized (events sorted, scores coerced to
  integers).
- Engine returns `{ result, reason, engineVersion, marketVersion }`.
  Persisted to `TicketSelection.result_meta` for audit.

## 3. Standard Match Result Model

```ts
type Finality = "PENDING" | "FINAL" | "AWARDED" | "VOID";

interface MatchResultV2 {
  schemaVersion: 2;
  source: "FIXTURE" | "MATCH";
  fixtureId?: string;
  matchId?: string;
  apiFixtureId?: number;

  status: string;
  finality: Finality;
  finalizedAt: string | null;

  scores: {
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
    extraTime?: { home: number | null; away: number | null };
    penalties?: { home: number | null; away: number | null };
  };

  stats: {
    cards: {
      home: { yellow: number; red: number };
      away: { yellow: number; red: number };
    };
    corners: { home: number; away: number };
    shotsOnTarget?: { home: number; away: number };
  };

  events: Array<GoalEvent | CardEvent>;

  resultLabel?: string | null;

  provider: "API_SPORTS" | "ADMIN" | "MANUAL_OVERRIDE";
  resultVersion: number;
  hash: string;
}
```

See `services/matchResult/v2.js` for the canonical shape and builders.

## 4. Market Registry

`MARKET_REGISTRY` is a frozen map `code → MarketModule`. Aliases are
resolved by `resolveCode(input)` which trawls each module's `aliases`.
The registry throws at startup on duplicate codes.

## 5. Market Module Interface

```ts
interface MarketModule {
  code: string;
  version: number;
  aliases?: string[];
  description: string;
  requiredResultFields: string[];
  settlePolicy: SettlePolicy;

  validate(params, ctx): NormalizedParams; // placement-time
  canEvaluate(mr): boolean; // runtime gate
  evaluate(sel, mr): { result; reason? }; // pure grader
}
```

## 6. Core Evaluation Engine

Strict state machine:

1. `selection` null → `VOID / missing_selection`
2. `matchResult` null → `VOID / missing_match_result`
3. No `market_code` → `VOID / legacy_unmapped`
4. Code not in registry → `VOID / unknown_market`
5. `finality === PENDING` → `PENDING / match_not_finalized` (the
   **only** legitimate `PENDING`)
6. `finality === VOID` → `VOID / match_voided`
7. `finality === AWARDED && !scores && policy` → `VOID / awarded_without_scores`
8. `!module.canEvaluate(mr)` → `VOID / missing_required_data`
9. Module throws → `VOID / module_error:<code>`
10. Module returns non-{WON|LOST|VOID} → `VOID / module_contract_violation`

## 7. Settlement Rules (CRITICAL)

- Never return `PENDING` after final.
- Unknown market = `VOID`.
- Missing required data after final = `VOID`.
- Voided fixture = `VOID` for every leg.
- All-VOID ticket → ticket `VOID` + full-stake refund (`bet-refund:<id>`).
- Mixed ticket (some WON, some VOID) → ticket WON; VOID legs multiply
  by 1.0.
- Any LOST leg → ticket LOST.

## 8. Ticket-level implications

```text
if anyLost:
    status = LOST, potential_win = 0
elif allResolved && allVoid:
    status = VOID, refund stake (bet-refund:<ticketId>)
elif allResolved:
    status = WON, total_odds = ∏ legMultiplier(l), potential_win = stake * total_odds
else:
    unchanged
```

## 9. Placement-time validation

Before persisting a `TicketSelection`, the controller MUST call
`MARKET_REGISTRY.validate(code, params, ctx)`. The canonical params
returned by `validate()` are what is persisted.

## 10. Data requirements

- `Fixture.ht_home_score`, `Fixture.ht_away_score`
- `Fixture.et_*`, `Fixture.pen_*` (optional)
- `Fixture.events_payload`, `Fixture.stats_payload`
- `Fixture.result_version`, `Fixture.result_hash`, `Fixture.finality`
- `Fixture.grading_completed_at`
- `TicketSelection.result_meta`, `TicketSelection.market_version`
- `Transaction.reference @unique`

## 11. Migration

Phase 0 (prep) → Phase 1 (shadow) → Phase 2 (new markets on v2 only)
→ Phase 3 (full cutover via `SETTLEMENT_ENGINE=v2`) → Phase 4
(decommission v1). See implementation prompt in
`backend/docs/market-evaluator-v2-implementation.md` for full steps.

## 12. Universal safety checklist

- [ ] No PENDING after final.
- [ ] No market module performs I/O.
- [ ] No financial write without a unique `reference`.
- [ ] Every market has a module + tests.
- [ ] `recomputeTicketStatus` handles all-VOID → refund.
- [ ] `Fixture.grading_completed_at` set only when 0 pending legs remain.
- [ ] Money writes are inside the same `$transaction` as the related
      ticket update.
- [ ] Concurrent `settleFixture` calls converge.
- [ ] `engineVersion` + `marketVersion` persisted on every leg outcome.
