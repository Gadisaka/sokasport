# Bonus & Promotions System

## Overview

The platform provides promotional bonuses for players.

---

## Types of Bonuses

### Welcome Bonus (Registration Bonus)

Given when a player registers. Same as Registration bonus.

---

### First Deposit Bonus

Given on first deposit only.

---

### Deposit Bonus

Given on deposits (not restricted to first deposit).

---

### Accumulator Bonus

Applied when multiple matches are selected.

Example:

> More than 10 matches → +3% bonus

---

### Cashback

Players receive partial refund for losing bets.

Admin configures:

- Eligibility odds
- Loss rules
- Cashback percentage

---

---

## Admin Controls

Admin can:

- Edit bonus
- Enable/disable bonus

---

## Implementation (backend)

- **Storage:** `Bonus` model in Mongo (`name`, `type`, `percentage`, `min_deposit`, `rules` JSON, `status`). The schema enforces **exactly one document per `type`** (`@@unique([type])`). Preset rows for all six types are **created by `db seed`** (`upsert` by `type` with `update: {}` so re-seeding does **not** overwrite live admin edits). **Deploy note:** if an older database has **duplicate** bonuses sharing the same `type`, remove or merge duplicates before applying the unique constraint (e.g. keep the newest per type, delete the rest).
- **Admin API:** `GET /api/admin/bonuses`, `GET /api/admin/bonuses/:id`, `PATCH /api/admin/bonuses/:id` only — there is **no** `POST` to create bonuses. `PATCH` accepts only safe fields; `name`, `type`, and raw `rules` cannot be set by clients — the server builds `rules` from typed inputs (welcome fixed amount, deposit percentages, accumulator tiers, cashback eligibility gates + tiers, etc.). Cashback management is gated on `settings:read` / `settings:update`, held only by **SUPER_ADMIN** and **ADMIN**.
- **Ledger:** Bonus credits use `Transaction.type = BONUS` with unique `reference`:
  - Welcome: `bonus:welcome:<userId>`
  - Deposit (first or repeat): `bonus:deposit-tx:<playerDepositTransactionId>`
  - Cashback on loss: `bonus:cashback:<ticketId>`
- **Welcome:** `rules.fixedAmount` if set; otherwise `percentage` is treated as a **flat** currency amount.
- **Deposits (online verify + cashier → player):** On the player’s **first** deposit only, the system credits **max(FIRST_DEPOSIT %, DEPOSIT %)** against the same deposit amount (does not stack both). Later deposits use **DEPOSIT** only. `User.first_deposit_at` is set on first successful deposit.
- **Accumulator:** `rules.tiers[]` with `{ minLegs, bonusPercent }`; highest matching tier applies. Gross win = `stake × totalOdds × (1 + bonusPercent/100)`. Snapshotted on the ticket as `accumulator_bonus_percent`; settlement recomputes WON payout using this snapshot.
- **Cashback (tiered v2):** `rules` holds `minSelections`, `minStake`, `maxHours`, `minResult`, `disqualifyFixtureStatuses[]`, `disqualifyMatchStatuses[]`, and `tiers[]` of `{ minResult, maxResult, stakeMultiplier }` (inclusive ranges; last tier may set `maxResult: null` for open-ended). When a ticket becomes **LOST**, eligible **online** tickets (`user_id` set, not cashier-printed) receive **once** `stake × multiplier`, where the multiplier is picked from the tier matching `result = total_odds / largest-lost-leg-odds`. Gates: leg count must exceed `minSelections`, `stake ≥ minStake`, time from `created_at` to settlement `≤ maxHours` (0 = no limit), no leg on a disqualified fixture/match status, and `result ≥ minResult`. The engine (`lib/bonusEngine.js → evaluateCashback`) is pure and unit-tested; settlement (`creditCashbackOnLostTicketInTx`) loads the slip's selections + live fixture/match statuses. **Legacy fallback:** if no `tiers` are configured, the old flat `percentOfStake` model still applies for backward compatibility.
- **Admin UI:** Settings → **Cashback** tab (dedicated `CashbackPanel`); other bonuses remain on the **Bonuses** tab (`/api/admin/bonuses`).
- **Public config for slip:** `GET /api/bets/bonuses/active` — active bonuses (sanitized) for frontend preview.

**Future:** separate locked `bonus_balance` / wagering — v1 credits to main `Wallet.balance`.
