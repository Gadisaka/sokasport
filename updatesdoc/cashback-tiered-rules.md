# Cashback tiered rules — gap analysis & implementation plan

**Status:** Implemented (2026-05-30)  
**Last reviewed:** 2026-05-30

---

## Implementation notes (2026-05-30)

Shipped per the locked decisions: time window anchored on `ticket.created_at`,
disqualify if **any** leg sits on a postponed/canceled/stopped fixture/match,
ratio uses **placement-time** total odds, and a **dedicated Cashback tab** in
admin Settings. Engine stays backward compatible (legacy flat `percentOfStake`
applies when no `tiers` are configured).

Delivered changes:

- Engine: `pickCashbackTier`, `evaluateCashback`, refactored `computeCashbackAmount` in [backend/lib/bonusEngine.js](../backend/lib/bonusEngine.js) (+ tests in [backend/tests/bonusEngine.test.js](../backend/tests/bonusEngine.test.js)).
- Settlement: `creditCashbackOnLostTicketInTx` loads selections + fixture/match statuses ([backend/lib/bonusEngine.js](../backend/lib/bonusEngine.js)); tier + PST-disqualify tests in [backend/tests/ticketSettlementService.test.js](../backend/tests/ticketSettlementService.test.js).
- API: tiered validation in [backend/controllers/bonusController.js](../backend/controllers/bonusController.js).
- Admin UI: new [admin/src/components/settings/CashbackPanel.jsx](../admin/src/components/settings/CashbackPanel.jsx), tab wired in [admin/src/pages/SettingsPage.jsx](../admin/src/pages/SettingsPage.jsx); cashback editing removed from `BonusesPanel.jsx`.
- Seed + docs: default tiers in [backend/lib/ensureBonusPresets.js](../backend/lib/ensureBonusPresets.js); [backend/docs/bonus-promotions.md](../backend/docs/bonus-promotions.md) updated.

Note: `ensureBonusPresets` uses `upsert ... update: {}`, so **existing** databases keep their old CASHBACK `rules`. Configure tiers via the new Cashback tab (or reseed a fresh DB) to activate v2 on an existing environment.

---

## Executive summary

The product rules below describe a **ratio-based, tiered cashback** program. The live system only supported a **flat percentage of stake** when total odds met a single minimum. The tier logic, eligibility gates, and lost-leg ratio math have now been implemented as described below.

This document maps **required vs current**, proposes a **`rules` JSON shape**, and lists the **backend, admin UI, and test** work needed to ship it.

---

## Required rules (product spec)

| # | Rule | Configurable value |
|---|------|-------------------|
| 1 | Minimum selections on the slip | `minSelections` — cashback only if **selection count > N** (any per-leg odds) |
| 2 | Minimum stake | `minStake` — `stake >= minStake` |
| 3 | Time window | `maxHours` — cashback only if settlement happens **within N hours** of a defined anchor (see [Open questions](#open-questions)) |
| 4 | Disqualifying legs | No cashback if the ticket contains any **postponed, canceled, or stopped** selection |
| 5 | Payout tiers | `result = totalOdds / lostLegOdds`; tier chosen by `result`; payout = `stake × multiplier` |

### Example tiers (default seed values)

| `result` range (`totalOdds / lostLegOdds`) | Payout |
|--------------------------------------------|--------|
| 20 – 44 | `stake × 1` (100% of stake) |
| 45 – 79 | `stake × 2` |
| 80 – 99 | `stake × 3` |
| 100 – 199 | `stake × 4` |
| 200 – 399 | `stake × 5` |
| ≥ 400 | `stake × 10` |

Below **20**, no cashback.

### Worked example

- Total ticket odds: **96**
- Stake: **10** birr
- Lost leg odds: **2.3**
- `result = 96 / 2.3 = 41.73` → tier **20–44** → payout **10 × 1 = 10** birr

### Admin access

Only **ADMIN** and **SUPER_ADMIN** may view or edit cashback settings (Settings → Bonuses → Cashback section).

---

## Current implementation (what exists today)

### Engine (`backend/lib/bonusEngine.js`)

```js
// Simplified — actual code in computeCashbackAmount()
if (total_odds < minTotalOdds) return 0;
return roundMoney((stake * percentOfStake) / 100);
```

- Uses **`rules.minTotalOdds`** and **`rules.percentOfStake`** only.
- Does **not** read selection count, stake floor, hours window, fixture status, lost-leg odds, or tiers.
- Does **not** load ticket selections when computing cashback.

### Settlement hook (`backend/services/ticketSettlementService.js`)

- On ticket transition to **LOST**, calls `creditCashbackOnLostTicketInTx(ticketId)`.
- No selection or fixture context is passed.

### Admin UI (`admin/src/components/settings/BonusesPanel.jsx`)

Cashback edit form exposes only:

- Active toggle
- Minimum ticket total odds
- % of stake returned on loss

There is **no dedicated “Cashback” tab** — cashback lives under **Settings → Bonuses** as one row in the bonus programs table.

### API (`backend/controllers/bonusController.js`)

`PATCH /api/admin/bonuses/:id` accepts for CASHBACK:

- `status`
- `minTotalOdds`
- `percentOfStake`

### Permissions

| Role | Can manage cashback? |
|------|----------------------|
| SUPER_ADMIN | Yes (`*` permissions) |
| ADMIN | Yes (`*` permissions) |
| FINANCIAL_SUPPORT | No |
| AGENT / CASHIER / PLAYER | No |

**No change required** for role gating if cashback stays on existing bonus routes (`settings:read` / `settings:update`).

### Preset seed (`backend/lib/ensureBonusPresets.js`)

```json
{
  "type": "CASHBACK",
  "rules": { "minTotalOdds": 1.5, "percentOfStake": 0 },
  "status": false
}
```

---

## Gap matrix

| Requirement | Implemented? | Notes |
|-------------|--------------|-------|
| Selection count > N | **No** | Ticket has selections; engine never counts them |
| Stake >= minStake | **No** | Only checks `stake > 0` |
| Within N hours | **No** | No time anchor defined in code |
| Exclude PST / CANC / stopped legs | **No** | Void fixture statuses (`PST`, `CANC`, `ABD`) exist in settlement but are not checked for cashback |
| `totalOdds / lostOddOdds` tiers | **No** | Flat `%` of stake only |
| Stake × multiplier payout | **No** | Uses `%` not multiplier |
| Identify losing leg odds | **No** | Engine uses ticket-level fields only |
| Admin UI for all fields | **No** | Two fields only |
| Admin + Super Admin only | **Yes** | Already enforced via permissions |

---

## Proposed `rules` JSON schema

Store on the existing `Bonus` document (`type: "CASHBACK"`). Replace flat `%` fields with structured rules (keep old fields during migration for backward compatibility if needed).

```json
{
  "minSelections": 3,
  "minStake": 10,
  "maxHours": 72,
  "hoursAnchor": "ticket_created_at",
  "disqualifyFixtureStatuses": ["PST", "CANC", "ABD"],
  "minResult": 20,
  "tiers": [
    { "minResult": 20,  "maxResult": 44,  "stakeMultiplier": 1 },
    { "minResult": 45,  "maxResult": 79,  "stakeMultiplier": 2 },
    { "minResult": 80,  "maxResult": 99,  "stakeMultiplier": 3 },
    { "minResult": 100, "maxResult": 199, "stakeMultiplier": 4 },
    { "minResult": 200, "maxResult": 399, "stakeMultiplier": 5 },
    { "minResult": 400, "maxResult": null, "stakeMultiplier": 10 }
  ],
  "usePlacementTotalOdds": true
}
```

| Field | Meaning |
|-------|---------|
| `minSelections` | Cashback if `selections.length > minSelections` |
| `minStake` | Minimum stake (currency units) |
| `maxHours` | Max hours from anchor to settlement |
| `hoursAnchor` | `"ticket_created_at"` \| `"first_kickoff_at"` (confirm with product) |
| `disqualifyFixtureStatuses` | If any selection’s fixture has one of these statuses at grading time, ticket is ineligible |
| `minResult` | Global floor; below this ratio, no cashback |
| `tiers[]` | Inclusive ranges on `result`; first matching tier wins |
| `stakeMultiplier` | Payout = `roundMoney(stake × stakeMultiplier)` |
| `usePlacementTotalOdds` | If `true`, use odds locked at placement; if `false`, recompute from non-void legs at settlement |

**Deprecated (remove from UI after migration):** `minTotalOdds`, `percentOfStake`.

---

## Core algorithm (target)

Run inside `creditCashbackOnLostTicketInTx` (or a new `evaluateCashbackEligibility` helper).

```
1. Load ticket + selections (+ fixture.status per selection).
2. Guard: bonus active, online player ticket, not cashier-printed, status LOST.
3. Guard: selections.length > rules.minSelections.
4. Guard: stake >= rules.minStake.
5. Guard: hours since anchor <= rules.maxHours.
6. Guard: no selection linked to fixture with status in disqualifyFixtureStatuses
          (also treat selection.result === VOID with void reason match_voided / fixture void).
7. Find losing leg(s): selections where result === LOST.
   - Standard accumulator: exactly one LOST leg triggers LOST ticket (use that leg).
   - If multiple LOST (edge case): document policy — recommend first LOST by settlement order.
8. totalOdds = ticket.total_odds at placement (or recomputed product of WON+pending leg odds at loss time — confirm).
9. lostLegOdds = losing selection.odds (locked at placement).
10. result = totalOdds / lostLegOdds.
11. If result < rules.minResult → not eligible.
12. Match tier where minResult <= result <= maxResult (null max = infinity).
13. amount = roundMoney(stake × tier.stakeMultiplier).
14. Credit wallet via existing creditBonusIfNew(reference: bonus:cashback:<ticketId>).
```

### Fixture status mapping (already in codebase)

From `ticketSettlementService.js`:

- **Void / disqualifying:** `CANC`, `ABD`, `PST` (canceled, abandoned, postponed)
- **Final:** `FT`, `AET`, `PEN`, `AWD`, `WO`

Match-level `MatchStatus.SUSPENDED` may also count as “stopped” — confirm with product.

---

## Implementation checklist

### Phase 1 — Backend engine

| Task | File(s) |
|------|---------|
| Add `evaluateCashbackEligibility(ticket, selections, fixtures, bonus, settledAt)` | `backend/lib/bonusEngine.js` |
| Replace `computeCashbackAmount` flat logic with tier + gate checks | `backend/lib/bonusEngine.js` |
| Load selections + fixture status in `creditCashbackOnLostTicketInTx` | `backend/lib/bonusEngine.js` |
| Validate new PATCH body fields; build `rules` server-side | `backend/controllers/bonusController.js` |
| Update preset seed with default tiers (status still `false`) | `backend/lib/ensureBonusPresets.js` |
| Extend `sanitizeBonusForPublic` for player-facing preview (optional) | `backend/lib/bonusEngine.js` |

### Phase 2 — Admin UI

| Task | File(s) |
|------|---------|
| Replace flat odds / % fields with tier editor + eligibility fields | `admin/src/components/settings/BonusesPanel.jsx` |
| Optional: split **Cashback** into its own Settings sub-tab | `admin/src/pages/SettingsPage.jsx` |
| Show tier summary in bonuses table | `BriefSummary` in `BonusesPanel.jsx` |
| Client validation: non-overlapping tiers, ascending ranges | `BonusesPanel.jsx` |

Suggested form fields under **Settings → Bonuses → Cashback**:

- Active
- Min selections (integer, “cashback when count **greater than** this”)
- Min stake
- Max hours + anchor dropdown
- Tier table: min result | max result | stake multiplier (add/remove rows, max ~10)
- Help text with the 96 / 2.3 / 41.73 example

### Phase 3 — Tests

| Case | Expected |
|------|----------|
| Example: odds 96, stake 10, lost 2.3 | Pays 10 |
| result = 19.9 | No cashback |
| result = 45 | Tier 45–79 → stake × 2 |
| selections ≤ minSelections | No cashback |
| stake < minStake | No cashback |
| Ticket with PST fixture on any leg | No cashback |
| Outside maxHours window | No cashback |
| Cashier-printed ticket | No cashback (existing) |
| Duplicate settlement | Idempotent (existing) |

Files: `backend/tests/bonusEngine.test.js`, `backend/tests/ticketSettlementService.test.js`.

### Phase 4 — Docs & ops

| Task | File(s) |
|------|---------|
| Replace cashback section in bonus docs | `backend/docs/bonus-promotions.md` |
| Migration note for admins | This file or release notes |
| Optional cashback report filter by tier | `backend/docs/reports.md` |

---

## API changes

### `PATCH /api/admin/bonuses/:id` (type CASHBACK)

**New allowed body keys:**

```ts
{
  status?: boolean;
  minSelections?: number;      // integer >= 0
  minStake?: number;           // >= 0
  maxHours?: number;           // > 0
  hoursAnchor?: "ticket_created_at" | "first_kickoff_at";
  minResult?: number;          // >= 0, default 20
  tiers?: Array<{
    minResult: number;
    maxResult: number | null;
    stakeMultiplier: number;   // >= 0
  }>;
}
```

**Validation rules:**

- Tiers sorted by `minResult`, no gaps/overlaps, last tier may have `maxResult: null`.
- At most 10 tiers (align with accumulator cap pattern).
- Reject unknown keys (existing behavior).

---

## Open questions (confirm before build)

1. **`maxHours` anchor** — From ticket creation, from first match kickoff, or from last match end?
2. **Total odds source** — Placement-time `ticket.total_odds` (recommended for audit) or recomputed at loss?
3. **Disqualifying legs** — Ineligible if **any** leg is PST/CANC/ABD, or only if the **lost** leg is on such a fixture? (Spec reads as “any leg on the ticket”.)
4. **Multiple LOST legs** — Impossible in normal acca flow; define behavior for manual re-grades.
5. **“Stopped”** — Map to `ABD`, `SUSPENDED`, or API-specific live-stop codes?
6. **Dedicated Cashback tab** — New Settings tab vs expanded row in Bonuses table (both satisfy “under cashback” in UI).
7. **Backward compatibility** — One-time migration script to convert `percentOfStake` presets to tier v2, or hard cutover?

---

## Migration from v1 (flat %)

1. Deploy engine that supports **both** schemas: if `rules.tiers` present, use v2; else fall back to `percentOfStake`.
2. Update admin UI to v2 fields; on save, write `tiers` and clear deprecated keys.
3. Admin manually configures tiers to match product table (or run a one-off script setting default tiers from this doc).
4. Remove v1 fallback after verification.

---

## Files to touch (summary)

```
backend/lib/bonusEngine.js
backend/lib/ensureBonusPresets.js
backend/controllers/bonusController.js
backend/services/ticketSettlementService.js   # only if settlement must pass settledAt/fixtures
backend/tests/bonusEngine.test.js
backend/tests/ticketSettlementService.test.js
backend/docs/bonus-promotions.md
admin/src/components/settings/BonusesPanel.jsx
admin/src/pages/SettingsPage.jsx              # optional dedicated tab
```

---

## Related code references

| Area | Location |
|------|----------|
| Current cashback math | `backend/lib/bonusEngine.js` → `computeCashbackAmount`, `creditCashbackOnLostTicketInTx` |
| LOST transition | `backend/services/ticketSettlementService.js` → `recomputeAndCreditTickets` |
| Void fixture statuses | `backend/services/ticketSettlementService.js` → `VOID_FIXTURE_STATUSES` |
| Admin bonus PATCH | `backend/controllers/bonusController.js` |
| Admin UI | `admin/src/components/settings/BonusesPanel.jsx` |
| Permissions | `backend/lib/permissions.js` |
