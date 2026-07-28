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
  - Cashback on loss (online wallet): `bonus:cashback:<ticketId>`
  - Cashback on loss (cashier counter): `cashback-payout:<ticketId>`
- **Welcome:** `rules.fixedAmount` if set; otherwise `percentage` is treated as a **flat** currency amount.
- **Deposits (online verify + cashier → player):** On the player’s **first** deposit only, the system credits **max(FIRST_DEPOSIT %, DEPOSIT %)** against the same deposit amount (does not stack both). Later deposits use **DEPOSIT** only. `User.first_deposit_at` is set on first successful deposit.
- **Accumulator:** `rules.tiers[]` with `{ minLegs, bonusPercent }`; highest matching tier applies. Gross win = `stake × totalOdds × (1 + bonusPercent/100)`. Snapshotted on the ticket as `accumulator_bonus_percent`; settlement recomputes WON payout using this snapshot.
- **Cashback (tiered v2):** `rules` holds `minSelections`, `minStake`, `maxHours`, `minResult`, `disqualifyFixtureStatuses[]`, `disqualifyMatchStatuses[]`, and `tiers[]` of `{ minResult, maxResult, stakeMultiplier }` (inclusive ranges; last tier may set `maxResult: null` for open-ended). Amount = `stake × multiplier`, where the multiplier is picked from the tier matching `result = total_odds / largest-lost-leg-odds`. Gates: leg count must exceed `minSelections`, `stake ≥ minStake`, no leg on a disqualified fixture/match status, and `result ≥ minResult`.
  - **Online tickets** (`user_id` set, not cashier-printed): credited **once** to the player wallet when the ticket becomes **LOST** (`creditCashbackOnLostTicketInTx`). `maxHours` is measured from `created_at` → settlement time.
  - **Cashier-printed tickets**: not auto-credited (no player wallet). Cashiers pay at the counter via `GET /api/tickets/:id/cashback-quote` + `PATCH /api/tickets/:id/cashback-payout` (permission `tickets:payout`). Eligibility is re-evaluated at **claim time** (`maxHours` = placement → scan). On success the cashier wallet is credited, a `BONUS` ledger row with reference `cashback-payout:<ticketId>` is written, and the ticket moves `LOST` → `CASHBACK_PAID`.
  - **Legacy fallback:** if no `tiers` are configured, the old flat `percentOfStake` model still applies for online tickets.
- **Admin UI:** Settings → **Cashback** tab (dedicated `CashbackPanel`); other bonuses remain on the **Bonuses** tab (`/api/admin/bonuses`). Cashier **Payout and Cancel** tab includes a **Pay Cashback** action for LOST printed slips.
- **Public config for slip:** `GET /api/bets/bonuses/active` — active bonuses (sanitized) for frontend preview.

**Future:** separate locked `bonus_balance` / wagering — v1 credits to main `Wallet.balance`.
