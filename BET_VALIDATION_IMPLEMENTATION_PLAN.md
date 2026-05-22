# Bet Validation & Odds Synchronization — Implementation Plan

> Analysis target: Sokasport sportsbook platform (Node/Express + Prisma/MongoDB + Redis + BullMQ + React)
>
> Scope: pre-match player betting, anonymous pre-book + cashier confirm, live betting.
>
> Status: **no application code has been changed**. This document is the result of a deep architecture audit and is the source of truth for the work that follows.

---

## 0. TL;DR

The current platform accepts **client-supplied odds verbatim** at ticket placement, never re-fetches the upstream price, never checks whether the market is suspended, and only verifies kickoff/status for the legacy admin `Match` path. The wallet debit happens inside a Prisma `$transaction` (good) but there is no idempotency key from the client, no per-wallet lock, and no upper bound on concurrent inserts.

In short — **there is no real placement-time validation engine today.** The closest thing is `MARKET_REGISTRY.validate()` (which only validates that a market _code_ and its parameter _shape_ are well-formed, not that the price or market is still live).

A correct sportsbook MUST:

1. Recompute odds from a server-trusted source on every placement (`accept-changed` confirmation flow).
2. Check market status (open/suspended/closed) on every leg.
3. Atomically debit the wallet through a deterministic idempotency key.
4. Distinguish live and pre-match validation strictness.
5. Push odds and suspension changes to the client in real time so the slip never silently keeps stale prices.
6. Keep ticket placement fully internal: placement reads only Redis + MongoDB/Prisma, never provider HTTP.

This plan is the engineering roadmap to get there.

---

## 1. Current Architecture Overview

### 1.1 Topology

```
React (frontend/, admin/) ──► Express API (backend/)
                                  │
                                  ├── Prisma (MongoDB)
                                  │      ├── Fixture / FixtureMarket / FixtureOddLine   (sports feed)
                                  │      ├── Match / Odd                                 (legacy admin)
                                  │      ├── Wallet / Transaction
                                  │      └── Ticket / TicketSelection
                                  │
                                  ├── ioredis (cache only — not used as a lock)
                                  └── BullMQ workers (jobs/syncOdds.js, syncLiveFixtures.js, syncFixtures.js)
                                              │
                                              └── API-Sports (https provider)
```

### 1.2 Two parallel data paths

The codebase carries **two distinct selection models** in `TicketSelection`:

| Column                    | Source                      | Used by                              |
| ------------------------- | --------------------------- | ------------------------------------ |
| `match_id`                | Admin-managed `Match` table | `POST /api/tickets` (legacy cashier) |
| `fixture_id`              | Feed-driven `Fixture` table | `POST /api/bets/place` (sportsbook)  |
| `selection_snapshot` JSON | Free-form prebook snapshot  | Both, for display continuity         |

`TicketSelection` can populate either column, plus `selection_snapshot` for display.

### 1.3 Bet placement endpoints

| Endpoint                                      | Handler               | Path purpose                                                                                                                                                          |
| --------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/bets/place` (public)               | `createPrebookTicket` | Sportsbook frontend + anonymous coupons. If `Authorization` header present → debits **player wallet** inside `$transaction`. If anonymous → creates OPEN ticket only. |
| `POST /api/tickets` (auth + perm)             | `createTicket`        | Legacy direct cashier ticket create against `Match` rows. **Does not** debit any wallet at create.                                                                    |
| `PATCH /api/tickets/:id/confirm-print` (auth) | `confirmPrintTicket`  | Cashier scans a coupon and finalizes the sale. **Debits cashier wallet** inside `$transaction`. Idempotent on `reference = ticket-print:{id}`.                        |
| `PATCH /api/tickets/:id/stake` (auth)         | `updateTicketStake`   | Allowed only while ticket is `OPEN` and pre-print. Recomputes potential win.                                                                                          |
| `PATCH /api/tickets/:id/cancel` (auth)        | `cancelTicket`        | Cancels OPEN/PRINTED within admin-configured window; rejects if any leg has started.                                                                                  |

### 1.4 Trace — public player bet (today)

```
[Frontend] BetSlipPanel.handlePlaceBet
      └── placeBet(selections, stakeNum)   in services/api.js
            └── fetch POST /api/bets/place  body: { selections: [{ apiFixtureId, marketCode, marketParams, label, odds }], stake }

[Backend] createPrebookTicket (controllers/ticketsController.js, line 896)
      1. optionalAuthenticateToken decodes Bearer (may be null)
      2. validate stake, selection.odds > 1, normalize via MARKET_REGISTRY when PLACEMENT_VALIDATION=v2
      3. resolveAccumulatorForNewTicket → bonus %, gross potential win
      4. resolveBettingLimits / capGrossPotentialWin / getStakeAndPotentialWinViolation (stake bounds only)
      5. resolveCouponNumberForCreate (reuse coupon iff signature matches)
      6. snapshotWinningsTaxForNewTicket
      7. IF authenticated:
            prisma.$transaction(tx):
                reserveUniqueReceiptNumber
                find PLAYER wallet
                balanceBefore >= numericStake ?
                wallet.update balance = before - stake
                transaction.create  type=BET  reference=ticket:{receiptNumber}
                ticket.create  status=OPEN  ...selections...
         ELSE:
            ticket.create directly (no debit)
      8. respond 201 { ticketId, couponNumber, receiptNumber, totalOdds, stake, potentialWin, status }
```

**Observations from the trace:**

- `s.value` (the price displayed in the UI) is sent as `odds` and stored verbatim. There is no server-side comparison with `FixtureOddLine.odd` or any upstream call.
- The fixture row is never read at placement — kickoff time, status, presence in odds horizon all unchecked.
- Market suspension (`v.suspended` in upstream live odds, or `status = SUSPENDED` for admin matches) is **not consulted at all** for fixture-based tickets.
- The `match` flow does check `status === "SUSPENDED" || "FINISHED"` (line 723), but only the legacy `Match` model — the public frontend doesn't use it.
- `selection_snapshot` stores `matchName/marketLabel/label/odds` as the user submitted them. This is **display-only** — settlement reads `TicketSelection.market_code`, `market_params`, and `odds`.

### 1.5 Trace — cashier paper coupon

```
Player walks in with coupon code (printed on player phone after /bets/place).
Cashier:
   1. POST /api/cms/ticket-by-coupon (public lookup, mapPublicCouponPayload)
   2. PATCH /api/tickets/:id/confirm-print  (auth: tickets:create)
         confirmPrintTicket:
             - existing  Transaction WHERE reference = ticket-print:{id}  →  idempotent return
             - prisma.$transaction(tx):
                   claim cashier_id if null
                   find cashier wallet
                   balance >= ticket.stake ?
                   wallet.update balance -= ticket.stake
                   transaction.create  type=BET  reference=ticket-print:{id}
                   reserveUniqueReceiptNumber if missing
                   ticket.update status=PRINTED, receipt_number=...
```

The cashier flow inherits the same flaw — odds have already been frozen at the prebook step (often hours earlier in the day), and `confirmPrintTicket` never revalidates them, never refetches market status, never checks if the fixture is now LIVE or FINISHED.

### 1.6 Where odds come from at write-time

- **Frontend pre-match**: polls `GET /api/football/fixtures/today|upcoming|by-date` every ~30 s. The response is served from Redis (`fixtures:today:*`, TTL 1800 s) and built from `FixtureOddLine` rows. The cache key is bookmaker-scoped.
- **Frontend live**: polls `GET /api/football/odds/live` every ~10 s. The handler calls `getTransformedLiveOddsCoalesced()` which directly hits upstream API-Sports (`/odds/live`, `skipCache:true`), with a 2.5 s in-process dedupe.
- **`syncOdds.js` worker**: writes to `FixtureOddLine` every ~5 minutes (TTL `ODDS=300`).
- **`syncLiveFixtures.js` worker**: writes live scores + refreshed live odds when a score/status changes.

So the frontend already enjoys near-real-time prices, but **nothing on the backend trusts them** — they are pure display, and the ticket controller silently accepts whatever number the client posted.

### 1.7 Wallet & transactional integrity

- `prisma.$transaction` is used everywhere money moves. MongoDB transactions work via session-scoped reads/writes — they provide read-concern `snapshot` and write-concern `majority` under replica sets, so two concurrent debits on the same wallet do produce a write conflict that Prisma retries up to `Prisma.TransactionAlreadyClosedError` or returns the error.
- `Transaction.reference @unique` is the **only** idempotency mechanism. Every payout/print attempts the same reference (`ticket:{id}` or `ticket-print:{id}`) so a duplicate insert raises `P2002` and the controller responds 409.
- For `/bets/place` the reference is `ticket:{receiptNumber}` — but the receipt is freshly generated server-side per call, so **a retry of the same client request creates a brand-new receipt and a brand-new debit**. There is no `Idempotency-Key` header.
- There are no Redis-based locks anywhere.

### 1.8 Existing validation surface

| Layer                                     | What it does                                                                                            | Limits                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `authenticateToken`                       | JWT decode, attaches `req.user`                                                                         | Authentication only.                                  |
| `authorizePermission`                     | Role-based permission map                                                                               | Authorization only.                                   |
| `MARKET_REGISTRY.validate`                | Canonicalizes `market_code` + validates the shape of `market_params` (line numbers, sides, score range) | **Does not** check market liveness or compare `odds`. |
| `resolveBettingLimits`                    | Loads `MIN_BET_AMOUNT / MAX_BET_AMOUNT / MAX_WINNING_AMOUNT`                                            | Stake + win bounds only.                              |
| `capGrossPotentialWin`                    | Clamps `potential_win` to `MAX_WINNING_AMOUNT`                                                          | Silently shrinks payout, doesn't reject.              |
| `slipHasExpiredSelection` (frontend only) | Hides expired rows on the slip                                                                          | Pure UX — server doesn't enforce.                     |
| `resolveAccumulatorForNewTicket`          | Applies acca bonus from `BonusType.ACCUMULATOR`                                                         | Bonus calc only.                                      |

---

## 2. Existing Problems

> Severity: **C**ritical / **H**igh / **M**edium / **L**ow

### C-1. Client-supplied odds are trusted verbatim _(both pre-match & live)_

`createPrebookTicket` and `createTicket` write `odds: Number(item.odds)` straight from the request body into `TicketSelection.odds`. A malicious client can post `{ odds: 9999 }` and the server will compute `potential_win = stake × 9999`. The only ceiling is `MAX_WINNING_AMOUNT` (`capGrossPotentialWin`) — so on a system without that admin setting, the cap is `Infinity`.

> File: `backend/controllers/ticketsController.js:808,1042`.

### C-2. Markets are never checked for "open / suspended / closed" on Fixture path

For `Fixture`-backed tickets (the public sportsbook), the controller does not look at `Fixture.status`, never asks whether the bookmaker still prices that line, and never inspects `FixtureOddLine` to confirm the selection exists. Result: a player can bet on a market that disappeared 20 minutes ago, or on a fixture that already started.

> File: `backend/controllers/ticketsController.js:988-1005` (fixture lookup is just `findMany` to map `api_fixture_id → id`, no status filter).

### C-3. Kickoff time is not enforced server-side for the Fixture path

`isSelectionExpired()` lives only on the frontend (`frontend/src/utils/selectionExpiry.js`). The server lets you post a fixture whose `start_time` is in the past as long as the row exists.

> File: `backend/controllers/ticketsController.js:988-1005`.

### C-4. No idempotency key from the client

Receipt numbers are reserved on the server (`reserveUniqueReceiptNumber`) every call. If the client retries `POST /api/bets/place` due to a flaky network, the user is double-charged.

### H-1. No revalidation between pre-book and cashier confirmation

`confirmPrintTicket` debits the cashier wallet using `ticket.stake` and `ticket.total_odds` that may be hours stale. By then the fixture might be LIVE / FT, the bookmaker may have suspended the market, or the price may have drifted.

> File: `backend/controllers/ticketsController.js:1801-1968`.

### H-2. Race condition on player wallet during placement

The wallet read inside `$transaction` doesn't use `findUniqueOrThrow` with locking semantics — it relies on MongoDB transaction `write-conflict → retry`. In high-contention scenarios (player firing two `/bets/place` calls back-to-back) one of the two will retry, which means the _winning_ call's `balance_before` may not reflect a freshly-debited state, and the second call's balance check is repeated. In practice this is mostly safe, but **there is no row-level lock and no Redis distributed lock** — so when traffic crosses ~50 ticket inserts/sec on a single wallet, contention will eat throughput and could surface phantom `INSUFFICIENT_BALANCE` errors.

### H-3. Live tickets accept untrusted odds with zero revalidation against `/odds/live`

The live odds feed is fetched fresh on every poll but **never persisted**. There is literally no DB row to compare against at placement — and the controller doesn't refetch upstream either. A player can submit any odds value for a live selection and the server will accept it.

### H-4. No socket / WebSocket push — slip never knows odds changed

The frontend polls every 10 s for live and every 30 s for pre-match. Between polls the displayed price drifts. The user clicks "Place bet" and the controller takes their stale slip price as gospel. Industry standard is push (Socket.IO / SSE) so the client receives "this leg moved 1.85 → 1.65" and shows the "accept new odds" dialog before re-submitting.

### M-1. Coupon numbers are not unique

`coupon_number` is **not** declared `@unique` in `prisma/schema.prisma:387` — only indexed. `resolveCouponNumberForCreate` uses `findFirst` and accepts the first match, which is safe today only because the generator builds 8-char random strings. With ~3M coupons the birthday-paradox collision probability becomes meaningful (`2^32 / 10^7 ≈ 0.04%`).

### M-2. Selection-snapshot can drift from `TicketSelection`

`selection_snapshot` is written verbatim from the client and read by display/lookup endpoints (`mapPublicCouponPayload`). It can disagree with `TicketSelection.market_code/params/odds` if the client lies. Settlement uses `TicketSelection`, but display uses snapshot — so receipts can show one price while settlement uses another.

### M-3. `MARKET_REGISTRY.validate` runs only when `PLACEMENT_VALIDATION=v2`

Otherwise `inferMarketCode()` falls back to a fuzzy textual match (`backend/services/marketEvaluator.js`). Until v2 is the default, a poorly-named `marketLabel` produces unsettleable tickets.

### M-4. No rate limiting

There is no `express-rate-limit` or Redis token-bucket on `/api/bets/place` or `/api/tickets/*`. A bot can hammer the controller and exhaust the API-Sports daily quota or generate spurious coupons.

### M-5. No locking around live betting state transitions

When a fixture goes from `NS` → `LIVE`, there's no "betting freeze" window. The 30 s pre-match cache + the lack of server-side kickoff enforcement (see C-3) means tickets placed during the cache lag are accepted on already-started matches.

### L-1. Free-form `selection` string with no allow-list

`TicketSelection.selection` stores whatever string the client posts. Settlement uses `market_code`/`market_params` instead, so the string is "decorative" — but for display & audit it should be a controlled vocabulary.

### L-2. `confirmPrintTicket` claims an unowned cashier and updates branch info atomically — that's fine — but the branch fields are taken from the cashier profile at confirm time, not at sell time. So `branch_name` on the ticket may not equal where the player actually placed the bet (rare but possible if the cashier moves branches).

---

## 3. Missing Validation Steps (gap matrix)

Legend: ✅ implemented · ⚠ partial · ❌ missing

### 3.1 Player betting (logged-in)

| #   | Check                                               | Status | Notes                                                                                 |
| --- | --------------------------------------------------- | :----: | ------------------------------------------------------------------------------------- |
| 1   | Authenticate user (JWT)                             |   ✅   | `authenticateToken` / `optionalAuthenticateToken`                                     |
| 2   | Wallet existence                                    |   ✅   | `findFirst { user_id, wallet_type: PLAYER }`                                          |
| 3   | Sufficient balance                                  |   ✅   | inside `$transaction`                                                                 |
| 4   | Re-fetch latest odds                                |   ❌   | client value trusted verbatim                                                         |
| 5   | Compare incoming vs latest odds (tolerance band)    |   ❌   | no comparison performed                                                               |
| 6   | Detect changed odds                                 |   ❌   | impossible without (4)                                                                |
| 7   | Detect suspended market                             |   ❌   | `FixtureOddLine.value` has no `suspended` flag persisted                              |
| 8   | Detect closed/finished match                        |   ⚠    | `Match` path checks status; `Fixture` path does not                                   |
| 9   | Detect removed selection                            |   ❌   | no presence check                                                                     |
| 10  | Recompute total odds server-side                    |   ✅   | `selections.reduce((sum, item) => sum * Number(item.odds), 1)` — but uses client odds |
| 11  | Return updated odds to frontend if changed          |   ❌   | no `oddsChanged` response surface                                                     |
| 12  | Require user confirmation if odds changed           |   ❌   | no flow exists                                                                        |
| 13  | Atomic wallet deduction                             |   ✅   | `$transaction`                                                                        |
| 14  | Idempotency on retries                              |   ❌   | no `Idempotency-Key`, receipt is server-generated                                     |
| 15  | Prevent double-spending                             |   ⚠    | partial — MongoDB tx write-conflict only                                              |
| 16  | Rate limit                                          |   ❌   | absent                                                                                |
| 17  | Audit log on placement                              |   ⚠    | only on cashier create (`logAuditEvent("TICKET_CREATED")`); prebook does not audit    |
| 18  | Enforce server-side kickoff window                  |   ❌   | absent for `Fixture` path                                                             |
| 19  | Reject if ticket would exceed per-user exposure cap |   ❌   | only global `MAX_WINNING_AMOUNT`                                                      |

### 3.2 Cashier flow

| #   | Check                                                      | Status | Notes                                          |
| --- | ---------------------------------------------------------- | :----: | ---------------------------------------------- |
| 1   | Cashier auth + permission                                  |   ✅   | `authorizePermission("tickets:create")`        |
| 2   | Cashier wallet exists & funded                             |   ✅   | inside `confirmPrintTicket`                    |
| 3   | Latest odds re-validation at print                         |   ❌   | odds are whatever the player posted at prebook |
| 4   | Stale ticket detection (was placed long ago, market moved) |   ❌   | no max age check                               |
| 5   | Recompute odds                                             |   ❌   | `ticket.total_odds` reused as-is               |
| 6   | Live match suspension at print                             |   ❌   | not checked                                    |
| 7   | Prevent printing tickets on already-started fixtures       |   ❌   | no enforcement                                 |
| 8   | Deduct cashier wallet only on success                      |   ✅   | `$transaction`                                 |
| 9   | Idempotency on duplicate print attempts                    |   ✅   | `reference = ticket-print:{id}` unique         |
| 10  | Concurrent print safety                                    |   ✅   | P2002 surfaces as `alreadyPrinted=true`        |
| 11  | Audit                                                      |   ✅   | `TICKET_PRINT_CONFIRMED` audit event           |

### 3.3 Live betting

| #   | Check                                      | Status | Notes                                                                                            |
| --- | ------------------------------------------ | :----: | ------------------------------------------------------------------------------------------------ |
| 1   | Revalidate every leg against live odds     |   ❌   | live odds not even persisted                                                                     |
| 2   | Fetch latest odds in real time             |   ❌   | controller doesn't call upstream                                                                 |
| 3   | Handle `suspended` flag                    |   ❌   | flag dropped during transform (`transformLiveOddsForClient` filters them but only for _display_) |
| 4   | Handle fast-changing odds (tolerance band) |   ❌   | no band concept                                                                                  |
| 5   | Reject placements during locked states     |   ❌   | no "betting freeze" mechanism                                                                    |
| 6   | Atomic per-leg validation pipeline         |   ❌   | controller validates legs sequentially with no rollback semantics                                |
| 7   | Push fresh odds to frontend                |   ❌   | no socket; polling only                                                                          |
| 8   | Detect stale live tickets at submit        |   ❌   | `oddsTimestamp` not tracked                                                                      |

---

## 4. Risks in Current System

### 4.1 Direct financial loss

- **Stale-odds arbitrage** — a player keeps the slip open while the bookmaker drops 2.10 → 1.45 (e.g. on a red card just before kickoff). They submit at 2.10 and the server accepts. Expected value swings strongly negative for the house.
- **Suspended-line arbitrage** — same idea on the live path. The bookmaker pulls the line; the player still has the cached price; the controller accepts.
- **Client tampering** — a power user opens DevTools and edits the JSON body to set `odds: 1000`. Without `MAX_WINNING_AMOUNT`, this is unbounded.

### 4.2 Operational

- **Cashier confirms a print after the match starts** — refunds spike because tickets are written, then settled `LOST` or refunded via void.
- **Double-charge on retry** — flaky 3G drops the response; client retries; player wallet debited twice. Customer-support escalation.
- **Coupon collision** — improbable, but in a long-lived production system the lack of `@unique` on `coupon_number` invites silent collisions.

### 4.3 Reputational

- **Receipt shows different odds than the slip** because the snapshot can drift from the row. A handful of these screenshots on Twitter erode trust.
- **Lines move on the screen and the player has no idea** — modern players expect Bet365-style "odds changed, accept?" UX. Without it, complaints accumulate.

### 4.4 Regulatory

Many sportsbook regulators require **explicit per-leg revalidation, market-status snapshot, and immutable bet logs**. Today the system records _what the player asked for_, not _what the server confirmed_ — those two should always be a pair.

---

## Placement Path Must Never Depend on External HTTP

This is now a **strict architectural rule** for this project:

- Placement and validation endpoints (`/api/bets/validate`, `/api/bets/place`, cashier confirm flows) **must never call external odds providers directly**.
- Placement path may read from:
  - Redis
  - MongoDB via Prisma
- External HTTP providers are consumed only by background workers (`syncOdds`, `syncLiveFixtures`, fixture sync jobs).

### Why this is mandatory for sportsbook placement

1. **Latency risk** — external provider calls can swing from 40 ms to 2+ seconds; that is unacceptable on a money-moving path.
2. **Provider outage risk** — placement availability must not collapse because the odds feed has a transient outage.
3. **Rate-limit risk** — placement spikes would burn provider quotas quickly if each placement hit HTTP directly.
4. **Live instability risk** — fast-changing in-play markets need deterministic validation from internal snapshots, not variable upstream responses.
5. **Operational consistency** — all clients (player, cashier, admin tools) must validate against one internal canonical state.

### Required data flow

```
Workers (external API fetch + normalize + upsert)
    └──► Redis + MongoDB
            └──► Validation Engine
                    └──► Placement
```

### Explicitly forbidden flow

```
Placement endpoint ──► External odds API
```

---

## 5. Recommended Industry-Standard Flow

The mental model used by Bet365, William Hill, Pinnacle and similar operators:

```
Browse  ──►  Add to slip  ──►  Push odds update (socket)  ──►  Accept/Reject  ──►  Pre-validate
                                                                                       │
                                                                                       ▼
                                                                              ┌──── server ────┐
                                                                              │ for each leg:  │
                                                                              │ 1. resolve market & params
                                                                              │ 2. resolve authoritative odds (Redis/DB only)
                                                                              │ 3. compare with submitted (tolerance band)
                                                                              │ 4. confirm market is OPEN
                                                                              │ 5. confirm event not started (or `live = true`)
                                                                              │ 6. confirm fixture/event status is bettable
                                                                              └─────────┬─────┘
                                                                                        │
                                                              ┌──────── on any mismatch ─┘
                                                              ▼
                                                       respond 409 OddsChanged
                                                       (return new odds; client re-confirms)
                                                              │
                                                              ▼
                                                      client explicitly confirms
                                                              │
              ┌────── on full agreement ─────────────────────►┘
              ▼
  acquire idempotency lock (Redis SETNX, key = Idempotency-Key)
              │
              ▼
  DB transaction:
       wallet.balance >= stake?
       wallet.balance -= stake
       insert transaction (unique ref = idempotency key)
       insert ticket + selections (status = OPEN)
       commit
              │
              ▼
  release lock + audit log + push receipt via socket
```

Properties:

- **Pre-validation is a separate request** (`POST /api/bets/validate`) that does steps 1-6 without writing anything.
- **Mandatory confirmation UX**: if odds change, server returns `409 odds_changed`; ticket is **not placed** until the client re-submits with `acceptOddsChanges: true`.
- **Placement is idempotent on `Idempotency-Key`** generated client-side.
- **Live and pre-match share the pipeline** but live has stricter tolerance and the additional freeze check.
- **Placement never calls provider HTTP**; it uses only Redis/DB snapshots from workers.

### 5.1 Mandatory `acceptOddsChanges` confirmation contract

This project uses explicit odds acceptance for both legal clarity and operational correctness.

**Request field**

```json
{ "acceptOddsChanges": true }
```

**Rules**

1. First submission is expected with `acceptOddsChanges: false` (or omitted).
2. If any leg drifts beyond tolerance, server returns latest odds and `409 odds_changed`.
3. Server never auto-places after drift; client must show updated slip.
4. Player or cashier must explicitly confirm and re-submit with `acceptOddsChanges: true`.
5. If odds drift again after acceptance, a new `409 odds_changed` is returned and another explicit confirmation is required.
6. Live channel defaults to stricter tolerance (normally zero).

**Why this matters**

- **Legal/audit defensibility** — accepted odds are explicit, not implied.
- **Dispute reduction** — no silent repricing.
- **Operational safety** — same deterministic rule for player web and cashier print flow.

**Frontend UX requirements**

- Show previous odds vs latest odds per changed leg.
- Recompute and show new total odds / potential win before confirmation.
- Disable place/print until confirmation action is taken.
- Reopen confirmation modal if a second drift occurs.

We will build this in stages — staged refactors are in **Section 24**.

---

## 6. Pre-match Betting Validation Flow

### 6.1 Sequence

1. **Auth** — `authenticateToken` (or `optionalAuthenticateToken` for cashier kiosk pre-book).
2. **Schema validation** — body shape, stake > 0, stake within `MIN_BET_AMOUNT / MAX_BET_AMOUNT`, legs ≤ admin-configured max, legs ≥ 1, `Idempotency-Key` header non-empty, `acceptOddsChanges` boolean.
3. **Resolve fixtures** — for every `apiFixtureId`, `prisma.fixture.findFirst` with `select: { id, start_time, status, league: { sport } }`. Missing → fail with `unknown_fixture`.
4. **Per-leg validation** — for every leg:
   - `MARKET_REGISTRY.validate(marketCode, marketParams, { fixture })` (already exists; gate behind `PLACEMENT_VALIDATION=v2`).
   - `fixture.start_time > now + KICKOFF_BUFFER (default 30 s)`.
   - `fixture.status === "NS"` (or `TBD`).
   - `FixtureOddLine` lookup keyed by `(market_id, bookmaker_id, value)` — find the _current_ server-priced odd.
   - Compare with the client-submitted `odds` using an _odds tolerance band_ (see §9.3). If the price moved beyond tolerance:
     - when `acceptOddsChanges !== true` → return `409 odds_changed` with latest odds and recomputed totals
     - when `acceptOddsChanges === true` but odds changed again since last confirmation → return `409 odds_changed` again (new explicit confirmation required)
5. **Recompute totals** with **server odds**, not client odds.
6. **Bonus + caps** — `resolveAccumulatorForNewTicket`, `capGrossPotentialWin`, `getStakeAndPotentialWinViolation`.
7. **Optional per-user exposure cap** — sum open stake for this user in current period; reject if over cap (if feature enabled).
8. **Idempotency** — `SETNX idem:{userId|cashierId}:{idempotencyKey} -> hash` for 10 minutes. If set already, return the stored response.
9. **Wallet debit** — Prisma `$transaction` exactly as today, but the BET transaction's `reference = idem:{idempotencyKey}` so DB enforces uniqueness even if Redis is down.
10. **Audit log** — `TICKET_PLACED` with `before/after`, `meta = { idempotencyKey, serverOddsHash }`.
11. **Push receipt over socket** — see §12.

### 6.2 Edge cases

- **Late submission while we are computing** — handled by the kickoff buffer plus the wallet `$transaction` retry semantics.
- **Acca with mixed live + pre-match** — disallow at request time; modern books treat live-mix as a separate product.
- **Same-event multi-leg** — block at validation step (already done in `createTicket`; replicate for prebook).

---

## 7. Live Betting Validation Flow

Live betting needs everything in §6 plus:

- **Strict tolerance band** — typical industry tolerance for live = 0.00 (any change triggers re-confirm). We will make it configurable: `LIVE_ODDS_TOLERANCE` (default 0).
- **Live-odds source of truth** — read `LiveOddSnapshot` from Redis and fallback to MongoDB snapshot rows written by workers. Placement does not call provider HTTP.
- **Suspension check** — the upstream payload includes `suspended: true`. The current transform drops the line; the placement path must explicitly reject with `market_suspended`.
- **Stage-of-play guard** — reject during HT, ET, penalty intervals if business rules disallow them.
- **Mandatory explicit confirmation** — first drift returns `409 odds_changed`; user/cashier must re-submit with `acceptOddsChanges: true`. If drift happens again, require another explicit confirmation.
- **Confirmation freeze** — after validate returns OK, lock that leg's price in Redis for ~3 seconds (`SETEX freeze:{userId}:{fixtureId}:{marketCode}:{params} {odds} EX 3`) and require placement request to match within 3 s.

---

## 8. Cashier Booking Validation Flow

The cashier flow has three sub-flows today:

1. **Cashier-initiated direct ticket** (`POST /api/tickets`).
2. **Coupon-loaded prebook → confirm-print** (the common flow).
3. **Cashier on-screen "sell ticket" using the public sportsbook API** (web kiosk).

All three must run through the same pipeline as §6/§7:

- **At placement (1) or coupon load (2)** the cashier UI shows the slip with **server-confirmed prices** before the cashier hits "Print".
- **At print confirmation** the server re-runs validation with `mode = "confirm"`. Any drift > tolerance returns `409 odds_changed`; print is blocked until cashier explicitly re-submits with `acceptOddsChanges: true`.
- **Cashier wallet debit** stays inside the same `$transaction`.
- **Idempotency key** = `print:{ticketId}` (already idempotent, no change needed).
- **Cashier confirmation is mandatory** on changed odds, suspended lines, and expired legs before print.

---

## 9. External Odds Sync Strategy

### 9.1 Current cadence

| Job                            | Cadence | Persists to                         |
| ------------------------------ | ------- | ----------------------------------- |
| `syncOdds` (pre-match)         | ~5 min  | `FixtureOddLine` rows + Redis 300 s |
| `syncLiveFixtures` (live)      | ~30 s   | `Fixture` + `FixtureOddLine`        |
| `/odds/live` request-coalesced | 2.5 s   | Redis snapshot in-process (memory)  |

### 9.2 Recommended additions

1. **`live_odds_snapshot` Redis hash** — written by the live worker on every tick:
   `HSET live_odds:{apiFixtureId} {marketCode}|{params_hash} {odds}` with `EXPIRE 15 s`.
   Placement reads `HGET` — no upstream call on the hot path.
2. **`market_status` field** on `FixtureOddLine` (or a small `MarketState` collection) — `OPEN | SUSPENDED | CLOSED`. Sync workers populate from upstream `suspended` flag. Placement reads at validation step.
3. **Hash of authoritative odds at placement** — store `server_odds_hash` on `TicketSelection` (SHA-256 of `{marketCode, params, odds, sourceTimestamp}`) so audit can prove which line was used.
4. **Negative caching** — keep the existing `odds:fixture:{id}:no_odds` flag, but separately track `odds:fixture:{id}:suspended` with shorter TTL.

### 9.3 Odds-change tolerance band

| Channel          | Default tolerance | Override env                |
| ---------------- | :---------------: | --------------------------- |
| Pre-match acc    |  ±2 cents (0.02)  | `PREMATCH_ODDS_TOLERANCE`   |
| Pre-match single |     ±5 cents      | `PREMATCH_SINGLE_TOLERANCE` |
| Live             |       0.00        | `LIVE_ODDS_TOLERANCE`       |

Banding lets the slip survive a tiny upstream tick without bothering the user, while still rejecting genuine price moves.

### 9.4 Bookmaker source

Today `getPreferredBookmakerApiId()` picks a single bookmaker for ingestion. Placement should use the **same** bookmaker that priced the displayed line — store the `bookmaker_api_id` in the slip payload so re-validation can compare to the correct row.

---

## 10. Wallet Locking / Concurrency Protection

### 10.1 Two complementary layers

1. **DB-level**: `Transaction.reference @unique` already gives us terminal idempotency. Add a unique compound index on `(wallet_id, reference)` if we want per-wallet idempotency that survives across multiple `reference` shapes.
2. **App-level**: **Redis distributed lock** keyed on the wallet, acquired before the `$transaction`. Library: a tiny in-house `setnx`-with-TTL helper is enough (no need for full Redlock yet).

```js
async function withWalletLock(walletId, fn) {
  const key = `wallet:lock:${walletId}`;
  const token = crypto.randomBytes(16).toString("hex");
  const ok = await redis.set(key, token, "NX", "PX", 5_000);
  if (!ok) throw new Error("WALLET_LOCK_BUSY");
  try {
    return await fn();
  } finally {
    // release iff we still own the lock
    await redis.eval(
      `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
      1,
      key,
      token,
    );
  }
}
```

### 10.2 Why both

- DB unique reference catches the final write; Redis lock prevents two long-running validations from racing through the _expensive_ placement pipeline only to have one bounce off the DB.
- The lock also lets us serialize multi-bet acca placement when a player fires several slips at once.

---

## 11. Redis / Cache Strategy

| Purpose                                 | Key                                                   | TTL   | Producer              | Consumer             |
| --------------------------------------- | ----------------------------------------------------- | ----- | --------------------- | -------------------- |
| Pre-match upstream raw odds             | `odds:fixture:{apiId}:raw:v2`                         | 300 s | `syncOdds`            | worker parsing only  |
| Live odds per fixture (placement-grade) | `live_odds:{apiId}` (hash field per market/params)    | 15 s  | `syncLiveFixtures`    | placement validator  |
| Market state (open/suspended)           | `market_state:{apiId}` (hash field per market/params) | 15 s  | sync workers          | placement validator  |
| Validation idempotency                  | `idem:{actorId}:{key}`                                | 600 s | placement controller  | retries              |
| Wallet lock                             | `wallet:lock:{walletId}`                              | 5 s   | placement controller  | placement controller |
| Price freeze post-validate              | `freeze:{actorId}:{fixtureId}:{marketKey}`            | 3 s   | `POST /bets/validate` | `POST /bets/place`   |
| Rate limiter token-bucket               | `rl:bets:place:{actorId}`                             | 60 s  | rate middleware       | rate middleware      |

### 11.1 Cache invalidation

- Existing `deleteByPattern("fixtures:today:*" ...)` after `syncOdds`/`syncLive` — keep.
- New: `live_odds:*` entries are short-TTL only, no proactive invalidation.
- New: when a `MarketState` row flips to SUSPENDED, publish a Redis pub/sub message that the socket gateway broadcasts (see §12).

---

## 12. Socket.IO Live Odds Update Strategy

### 12.1 Stack

Add `socket.io` server. The package already pairs well with Express; mount on the existing HTTP server.

```js
// backend/index.js
import { createServer } from "node:http";
import { Server as IoServer } from "socket.io";
const httpServer = createServer(app);
const io = new IoServer(httpServer, { cors: { origin: "*" } });
httpServer.listen(port);
```

Use the Redis adapter (`@socket.io/redis-adapter`) for horizontal scaling across multiple API instances.

### 12.2 Rooms

| Room name             | Joined by                    | Used for                                  |
| --------------------- | ---------------------------- | ----------------------------------------- |
| `fixture:{apiId}`     | any client viewing a fixture | odds updates, score updates               |
| `live`                | live page viewers            | bulk live updates                         |
| `user:{userId}`       | logged-in player             | personal receipts, wallet balance updates |
| `cashier:{cashierId}` | cashier session              | print receipt push, wallet updates        |

### 12.3 Events

- `odds:update` `{ apiFixtureId, marketCode, params, odds, ts }` — emitted by the sync worker via Redis pub/sub fan-out.
- `market:suspended` `{ apiFixtureId, marketCode, params }`.
- `fixture:status` `{ apiFixtureId, status, elapsed }`.
- `ticket:placed` `{ ticketId, status, balance }` — per `user:{userId}`.
- `ticket:settled` `{ ticketId, status }`.

### 12.4 Frontend behaviour

- Slip subscribes to `fixture:{apiId}` for every leg.
- On `odds:update` if `Math.abs(new - shown) > tolerance` → flag the row; require user to accept new odds before placement.
- On `market:suspended` → mark the row red and disable the place button.

This is the single biggest UX win on the roadmap.

---

## 13. Admin Validation & Odds Monitoring Pages

These pages are required to operate validation safely at mid-scale without overengineering.

### A. LIVE ODDS MONITOR PAGE

**Purpose**

Monitor live odds synchronization health from worker pipeline to validation-read state.

**Core widgets**

- Fixture list with league, kickoff, live minute, current fixture state.
- Last live odds update timestamp.
- Market state badges: `OPEN`, `LOCKED`, `SUSPENDED`, `CLOSED`.
- Redis cache age (seconds since last `live_odds:{fixture}` update).
- DB odds age (seconds since last `FixtureOddLine`/snapshot update).
- Last worker sync time (`syncLiveFixtures` heartbeat).
- Stale odds detection warnings.
- Upstream sync health (worker status + last error, not placement HTTP checks).
- Provider latency metrics measured by workers.
- Missing market detection (expected market absent from Redis/DB snapshot).

**Operator actions**

- Force re-sync fixture (enqueue BullMQ job for fixture).
- Suspend fixture manually.
- Lock fixture manually.
- Re-open fixture manually.

### B. TICKET VALIDATION MONITOR

**Purpose**

Inspect placement failures and validation outcomes for players and cashiers.

**Core widgets**

- `odds_changed` logs.
- `market_suspended` logs.
- `fixture_started` logs.
- `insufficient_balance` logs.
- idempotency replay logs.
- Validation latency (p50/p95).
- Placement success/failure rates.

**Filters**

- By user.
- By cashier.
- By fixture.
- By time window.
- By rejection reason/code.

### C. LIVE MARKET CONTROL PANEL

**Purpose**

Manual sportsbook operator controls for exceptional live operations.

**Actions**

- Manually suspend market.
- Manually lock market.
- Manually reopen market.
- Manually void market.
- Manually close market.
- Force odds refresh (worker re-sync).
- Emergency stop for fixture (all markets to `SUSPENDED`).

**State semantics**

- `OPEN` — bettable, normal validation path.
- `LOCKED` — temporary no-bet state during rapid change; not accepted for placement.
- `SUSPENDED` — explicitly disabled (incident, integrity concern, feed issue).
- `CLOSED` — terminal no-bet state for that market/fixture.

### D. CASHIER VALIDATION VIEW

**Purpose**

Support cashier-side confirmation UX before printing/final booking.

**Required behaviour**

- Highlight changed odds per leg.
- Show previous odds vs latest odds side-by-side.
- Show mandatory confirmation modal when odds changed.
- Show expired selections clearly.
- Show suspended selections clearly.
- Require explicit cashier confirmation before print (with `acceptOddsChanges: true`).
- If odds change again after confirmation, show a new confirmation prompt.

---

## 14. Odds Engine

All odds validation logic should be centralized in one shared internal module:

`services/odds-engine/`

Suggested structure:

```text
services/odds-engine/
├── resolveOdds.js
├── resolveLiveOdds.js
├── compareOdds.js
├── marketState.js
├── freeze.js
├── normalize.js
├── validateSelections.js
└── tolerance.js
```

This engine must be the single reusable source for:

- player betting
- cashier booking/print confirmation
- live betting
- settlement sanity checks
- admin validation tools/monitors

By centralizing this logic, we avoid drift between channels and keep behaviour deterministic.

---

## 15. Suggested Database Changes

### 15.1 New columns

```prisma
model TicketSelection {
  // ... existing
  server_odds       Float?    // server-confirmed odds at placement
  server_odds_at    DateTime? // when those odds were sourced
  server_odds_hash  String?   // sha256(marketCode|params|odds|bookmaker|ts) for audit
  market_state      String?   // OPEN | SUSPENDED at placement
  live_at_placement Boolean   @default(false)
}

model Ticket {
  // ... existing
  idempotency_key   String?  @unique   // client-supplied
  channel           String?            // WEB | CASHIER | API
  validation_meta   Json?              // engine version, tolerance used, etc.
}

model Fixture {
  // ... existing
  // Optional snapshot of the latest *live* odds payload from syncLiveFixtures,
  // small enough to keep on the fixture row instead of a separate collection
  live_markets_snapshot Json?
  live_markets_snapshot_at DateTime?
}
```

### 15.2 New collection

```prisma
model MarketState {
  id               String   @id @default(uuid()) @map("_id")
  fixture_id       String
  market_code      String
  params_hash      String
  state            String   // OPEN | SUSPENDED | CLOSED
  source           String   // upstream provider id
  updated_at       DateTime @updatedAt

  fixture          Fixture  @relation(fields: [fixture_id], references: [id], onDelete: Cascade)

  @@unique([fixture_id, market_code, params_hash])
  @@index([fixture_id])
  @@index([state])
  @@map("market_states")
}
```

### 15.3 Index additions

- `Ticket.coupon_number` → make `@unique` (today only indexed). One-off migration to dedupe historical collisions before flipping the constraint.
- `Wallet.user_id` + composite `(user_id, wallet_type)` if you grow into multi-wallet — today fine.
- `Transaction.reference` already `@unique` — keep.

---

## 16. Suggested API Changes

### 16.1 New endpoints

| Verb + Path                                       | Purpose                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `POST /api/bets/validate`                         | Dry-run validation. Body identical to `/bets/place`. Returns updated odds / suspension flags. |
| `POST /api/bets/place` (revised)                  | Same as today + accepts `Idempotency-Key` header + accepts `acceptedOdds` per leg.            |
| `POST /api/cashier/tickets/validate`              | Cashier-scoped dry-run (used during coupon load).                                             |
| `PATCH /api/tickets/:id/confirm-print` (revised)  | Re-runs validation; returns `409 odds_changed` with payload to refresh UI.                    |
| `GET /api/football/fixtures/:apiId/markets/:code` | Authoritative server-side odds for one market (used by the slip after socket event).          |
| `GET /api/health/odds`                            | Operator endpoint: last-tick age per source.                                                  |

### 16.2 Revised response shape

```jsonc
// 200 OK — all good
{
  "ticketId": "...",
  "couponNumber": "ab123456",
  "receiptNumber": "12345-67890",
  "totalOdds": 6.74,
  "potentialWin": 67.40,
  "selections": [{ "fixtureId": "...", "marketCode": "OVER_UNDER", "marketParams": {...}, "odds": 1.92, "serverOdds": 1.92 }],
  "balance": 240.00
}

// 409 Conflict — odds changed mid-flight
{
  "code": "odds_changed",
  "requiresConfirmation": true,
  "selections": [
    { "index": 0, "submittedOdds": 1.92, "serverOdds": 1.85, "tolerance": 0.02 }
  ],
  "newTotalOdds": 6.55,
  "newPotentialWin": 65.50,
  "freezeWindowSeconds": 3
}

// 409 Conflict — market suspended
{
  "code": "market_suspended",
  "selections": [{ "index": 0, "fixtureId": "...", "marketCode": "..." }]
}

// 409 Conflict — fixture started
{
  "code": "fixture_started",
  "selections": [{ "index": 1, "fixtureId": "...", "kickoffAt": "..." }]
}
```

---

## 17. Suggested Middleware Structure

```text
backend/middleware/
├── auth.js                       // existing
├── rateLimit.js                  // new — token-bucket on Redis
├── idempotency.js                // new — reads Idempotency-Key, locks Redis, replays
├── requestSchema.js              // new — lightweight zod-style body validator
└── auditContext.js               // new — populates req.audit for downstream logEvent
```

- `rateLimit({ key: "bets:place", limit: 30, window: 60 })` — applied to `/api/bets/*`, `/api/tickets`.
- `idempotency({ scope: "bets" })` — only on POSTs that move money.
- `requestSchema(schema)` — validate body once, before controller logic.

---

## 18. Suggested Service Layer Structure

Move logic out of `ticketsController.js` (currently ~2000 lines) into focused services:

```text
backend/services/placement/
├── index.js                  // composeValidation, composePlacement
├── normalizer.js             // wraps MARKET_REGISTRY + accumulator/limit lookups
├── fixtureResolver.js        // batched fixture + market lookups
├── oddsValidator.js          // delegates to services/odds-engine/*
├── marketStateValidator.js   // open/suspended/closed checks
├── exposureValidator.js      // optional per-user open-stake cap
├── placementErrors.js        // typed errors (OddsChangedError, MarketSuspendedError, …)
└── placementResult.js        // serializer for HTTP + socket payloads

backend/services/odds-engine/
├── resolveOdds.js
├── resolveLiveOdds.js
├── compareOdds.js
├── marketState.js
├── freeze.js
├── normalize.js
├── validateSelections.js
└── tolerance.js

backend/services/wallet/
├── debit.js                  // withWalletLock + $transaction wrapper
└── refund.js                 // for cancel/void
```

Controllers become thin orchestrators:

```js
export async function createPrebookTicket(req, res) {
  const dto = await PlacementSchema.parse(req.body);
  const ctx = await placementContext(req);
  try {
    const validated = await validatePlacement(ctx, dto);
    const result = await placeBet(ctx, validated);
    return res.status(201).json(result.payload);
  } catch (e) {
    return mapPlacementErrorToHttp(res, e);
  }
}
```

---

## 19. Suggested Transaction Flow (single source of truth)

```text
1. (HTTP) parse body → DTO
2. middleware: rateLimit
3. middleware: idempotency.lock(key)
4. validatePlacement():
       4.1 normalize legs via MARKET_REGISTRY
       4.2 batched fixture resolver (one Mongo round-trip)
       4.3 marketStateValidator (Redis market_state hash, fallback DB)
       4.4 oddsValidator (Redis live_odds + DB FixtureOddLine, never external HTTP)
       4.5 stakeLimitsValidator
       4.6 accumulatorBonus.resolve
       4.7 optional exposureValidator (per-user cap if enabled)
       4.8 if any drift > tolerance and acceptOddsChanges !== true → throw OddsChangedError(legs[])
       4.9 if acceptOddsChanges === true but drift changed again → throw OddsChangedError(legs[]) again
5. wallet.debit():
       5.1 withWalletLock(walletId):
             5.1.1 prisma.$transaction:
                   - wallet.findUnique
                   - wallet.update balance -= stake
                   - transaction.create (reference = idempotency key)
                   - ticket.create  status = OPEN
                   - ticketSelection.createMany (server_odds, server_odds_hash, market_state)
       5.2 return { ticket, balance }
6. audit.log("TICKET_PLACED", { actorId, ticketId, idem, serverOddsHashes })
7. io.to(user/cashier room).emit("ticket:placed", payload)
8. middleware: idempotency.unlock(key)
9. respond 201
```

All steps after step 4 are inside a single logical unit — if 5 fails, 4's reservations evaporate (wallet lock TTL) and the client can safely retry with the same idempotency key.

---

## 20. Rollback Strategy

### 20.1 In-flight rollback (during placement)

- The `$transaction` rolls back balance + ticket + selections automatically on any throw.
- The Redis wallet lock auto-expires; we also release in `finally`.
- The freeze key auto-expires.
- The idempotency key remains so the client can retry with the same key and replay the stored failure.

### 20.2 Post-placement rollback (operator-initiated)

- Cancel within window: `cancelTicket` exists today; extend it to credit the player wallet (currently it only flips the status — the player wallet refund path lives in `cancelOwnPlayerTicket` in `playerController.js` which we'd verify in implementation).
- Void: `voidTicket` exists today; needs a paired `WalletRefund` transaction so the audit trail is symmetric. Reference convention: `void:{ticketId}`.

### 20.3 Settlement rollback

Out of scope for this plan, but the same patterns apply: every settlement write uses a unique `reference` (`settle:{ticketId}`), so a re-grade is a no-op.

---

## 21. Error Handling Strategy

### 21.1 Typed errors

```js
export class PlacementError extends Error {
  constructor(code, payload) {
    super(code);
    this.code = code;
    this.payload = payload;
  }
}
export class OddsChangedError extends PlacementError {}
export class MarketSuspendedError extends PlacementError {}
export class FixtureStartedError extends PlacementError {}
export class InsufficientBalanceError extends PlacementError {}
export class WalletLockBusyError extends PlacementError {}
```

### 21.2 HTTP mapping

| Error                        | HTTP | Body code                 |
| ---------------------------- | :--: | ------------------------- |
| `OddsChangedError`           | 409  | `odds_changed`            |
| `MarketSuspendedError`       | 409  | `market_suspended`        |
| `FixtureStartedError`        | 409  | `fixture_started`         |
| `InsufficientBalanceError`   | 400  | `insufficient_balance`    |
| `WalletLockBusyError`        | 423  | `wallet_busy` (retryable) |
| `ValidationError` (existing) | 400  | `invalid_selections`      |
| `MarketUnknownError`         | 400  | `unknown_market`          |
| unknown                      | 500  | `internal_error`          |

### 21.3 Client UX rules

- `409 odds_changed` → render an in-slip dialog: "Odds moved on 1 selection. New total: x.xx. Accept?" with `Accept` and `Cancel`. On accept, the client re-posts with `acceptedOdds` matching the new server odds.
- `423` → silent retry with exponential backoff (≤3 attempts).
- `429` → "Too many requests" toast.

---

## 22. Security Considerations

1. **Authoritative pricing** — the _only_ way odds enter `TicketSelection.odds` is through `oddsValidator.serverOdds`. Client `odds` becomes purely informational (used solely to detect drift).
2. **Wallet locking** — Redis lock protects against attempted double-spend even when the API process is replicated horizontally.
3. **Idempotency** — `Idempotency-Key` header (UUID v4) is mandatory on `/api/bets/place`. Missing → 400. Stored response replayed on duplicate within 10 minutes. After 10 minutes, lock has expired and any duplicate write would fail at the unique-`reference` constraint anyway.
4. **Rate limiting** — protects the upstream API-Sports quota and stops slip-spamming.
5. **Audit log** — every placement, cancel, void, payout records `actor, before, after, meta`. Already partially implemented (`logAuditEvent`); ensure prebook path also audits (currently does not).
6. **Per-user exposure cap** — admin-configurable max open-stake per player per day. Stops account-takeover attacks from draining a wallet quickly.
7. **CORS** — current `origin: "*"` is fine for B2C web; tighten when the API also serves trusted partners.
8. **HMAC over webhook deposits** — out of scope, already present in `onlineDepositController`.

---

## 23. Performance Considerations

1. **Validation is the new hot path** — keep `validatePlacement` ≤ 100 ms p95. Achievable because:
   - Fixture batch resolution is one indexed Mongo `findMany`.
   - Odds lookup hits Redis hash (`live_odds:{apiId}`) — O(1).
   - Market state hits Redis hash — O(1).
2. **Avoid upstream calls on the placement path** — the sync workers do all I/O ahead of time. If a key is missing in Redis, fall back to DB (`FixtureOddLine`), and asynchronously enqueue a `sync-odds` job for that fixture. Never block the placement on an HTTPS call to API-Sports.
3. **Socket fan-out** — `io.to("fixture:{apiId}").emit(...)` is O(rooms × clients in room). Bound the broadcast frequency to ≤ 1 Hz per fixture by coalescing successive odds changes within a 1-second window.
4. **MongoDB transactions are not free** — each tx pins a primary connection. Keep the critical section to wallet/transaction/ticket writes only; everything else (audit, socket emit, balance push) is best-effort post-commit.
5. **BullMQ queue concurrency = 1** for ingestion is fine for current scale; the _placement_ path runs on the API process and is horizontally scalable.

---

## 24. Step-by-Step Refactor Plan

Each step is a separate PR. Tests added at the same step it lands.

### Phase A — Foundations (no behaviour change)

- **A.1** Extract placement logic into `services/placement/*` and shared `services/odds-engine/*`; controllers become thin orchestrators.
- **A.2** Make `PLACEMENT_VALIDATION=v2` the default; remove the legacy `inferMarketCode` fallback once the test suite is green.
- **A.3** Add `idempotency` middleware (skipped without `Idempotency-Key` header for backward compat) and accept the header on `/api/bets/place`. Begin logging missing-key incidents.
- **A.4** Add `rateLimit` middleware.

### Phase B — Server-trusted odds for pre-match

- **B.1** Implement `oddsValidator.fetchServerOdds(fixtureId, marketCode, params, bookmakerId)` reading `FixtureOddLine` rows; cache 5 s in Redis.
- **B.2** Wire into `validatePlacement` for pre-match path; emit `oddsChanged` on tolerance breach.
- **B.3** Add `POST /api/bets/validate` (dry-run).
- **B.4** Update frontend BetSlipPanel + MobileBetSlip to consume `409 odds_changed`, show mandatory odds confirmation, and re-submit with `acceptOddsChanges: true`.

### Phase C — Live odds source-of-truth

- **C.1** Add Redis hash `live_odds:{apiId}` writes inside `syncLiveFixtures`.
- **C.2** Add `MarketState` model + writes for `suspended`/`closed`.
- **C.3** Wire `oddsValidator` for live path with `LIVE_ODDS_TOLERANCE=0` default.
- **C.4** Add `marketStateValidator`.

### Phase D — Socket.IO push

- **D.1** Mount `socket.io` + Redis adapter; rooms `fixture:{apiId}` and `user:{userId}`.
- **D.2** Sync workers publish to a Redis channel; gateway broadcasts.
- **D.3** Frontend subscribes from BetSlip + match cards.
- **D.4** Deprecate the 10-second live polling on the frontend.

### Phase E — Wallet locking + basic exposure guard

- **E.1** Add `withWalletLock` Redis helper + use in `placeBet` and `confirmPrintTicket`.
- **E.2** Add optional per-user open-stake cap setting + enforcement.
- **E.3** Audit prebook placement (currently missing audit on `/bets/place`).

### Phase F — Schema hardening

- **F.1** Add `Ticket.idempotency_key @unique`, `TicketSelection.server_odds*`, `TicketSelection.market_state`.
- **F.2** Migration: backfill `server_odds = odds` for existing rows.
- **F.3** Make `Ticket.coupon_number` `@unique` after dedupe.

### Phase G — Cashier hardening

- **G.1** `confirmPrintTicket` runs full validation pipeline; surface `409 odds_changed` to cashier UI.
- **G.2** Cashier UI enforces mandatory confirmation (`acceptOddsChanges: true`) before print.
- **G.3** Build admin operating pages from Section 13 (live monitor, validation monitor, market control, cashier validation view).

---

## 25. Priority Order

| Rank | Item                                                | Risk addressed |
| :--: | --------------------------------------------------- | -------------- |
|  1   | Server-trusted pre-match odds (B.1–B.4)             | C-1, H-1       |
|  2   | Server-trusted live odds + suspension (C.1–C.4)     | C-1, H-3       |
|  3   | Idempotency middleware (A.3)                        | C-4            |
|  4   | Audit prebook placements + log all rejections (E.3) | Regulatory     |
|  5   | Wallet lock + optional per-user cap (E.1–E.2)       | H-2            |
|  6   | Schema additions (F.1–F.2)                          | Audit trail    |
|  7   | Cashier revalidation at confirm-print (G.1–G.2)     | H-1            |
|  8   | Socket push (D.1–D.4)                               | H-4, UX        |
|  9   | Rate limit (A.4)                                    | M-4            |
|  10  | Coupon uniqueness (F.3)                             | M-1            |

---

## 26. Example Validation Pipeline

```js
// backend/services/placement/index.js
export async function validatePlacement(ctx, dto) {
  const normalized = await normalizeLegs(dto.selections, ctx);
  const fixtures = await fixtureResolver.batch(normalized);
  await marketStateValidator.assertOpen(normalized, fixtures);
  await fixtureStartedValidator.assertNotStarted(normalized, fixtures, ctx.now);

  const serverOdds = await oddsValidator.fetchAll(normalized, fixtures, ctx);
  const drift = oddsValidator.compare(
    normalized,
    serverOdds,
    ctx.toleranceForChannel(dto.channel),
  );
  if (drift.length) {
    throw new OddsChangedError({
      selections: drift,
      newTotalOdds: serverOdds.reduce((p, s) => p * s.odds, 1),
      freezeWindowSeconds: 3,
      requiresConfirmation: true,
    });
  }

  await stakeLimits.assert(dto.stake, ctx.limits);
  const bonus = await accumulator.resolve(
    ctx.prisma,
    normalized.length,
    dto.stake,
    serverOdds,
  );
  const grossPotentialWin = capGrossPotentialWin(
    ctx.limits,
    bonus.potential_win,
  );
  if (ctx.flags.enablePerUserExposureCap) {
    await exposure.assert(ctx.actor, dto.stake, grossPotentialWin, ctx);
  }

  return {
    normalized,
    fixtures,
    serverOdds,
    grossPotentialWin,
    accumulator: bonus,
    freezeKey: await pricing.freeze(ctx.actor.id, normalized, serverOdds),
  };
}

export async function placeBet(ctx, validated) {
  return await wallet.withLock(ctx.actor.walletId, async () => {
    return await ctx.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { id: ctx.actor.walletId },
      });
      if (!wallet) throw new WalletNotFoundError();
      const before = Number(wallet.balance);
      if (before < validated.stake)
        throw new InsufficientBalanceError({ balance: before });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: before - validated.stake },
      });

      const transaction = await tx.transaction.create({
        data: {
          wallet_id: wallet.id,
          type: "BET",
          amount: validated.stake,
          balance_before: before,
          balance_after: before - validated.stake,
          reference: `idem:${ctx.idempotencyKey}`,
        },
      });

      const ticket = await tx.ticket.create({
        data: {
          coupon_number: await reserveUniqueCoupon(tx),
          receipt_number: await reserveUniqueReceiptNumber(tx),
          user_id: ctx.actor.userId,
          cashier_id: ctx.actor.cashierId ?? null,
          branch_name: ctx.actor.branchName ?? "",
          branch_location: ctx.actor.branchLocation ?? "",
          stake: validated.stake,
          total_odds: validated.serverTotalOdds,
          accumulator_bonus_percent:
            validated.accumulator.accumulator_bonus_percent,
          potential_win: validated.grossPotentialWin,
          status: "OPEN",
          idempotency_key: ctx.idempotencyKey,
          channel: ctx.channel,
          selection_snapshot: validated.snapshotForDisplay,
          selections: { create: validated.serverOdds.map(legRow) },
          ...(await snapshotWinningsTaxForNewTicket(tx)),
        },
      });

      return {
        ticket,
        balance: before - validated.stake,
        transactionId: transaction.id,
      };
    });
  });
}
```

---

## 27. Example Request / Response Payloads

### 27.1 Validate (dry-run) request

```http
POST /api/bets/validate
Authorization: Bearer eyJ...
Content-Type: application/json
Idempotency-Key: f5b5b8c0-2c8d-4d9e-9c1d-001122334455

{
  "channel": "WEB",
  "stake": 20,
  "selections": [
    {
      "apiFixtureId": 1234567,
      "marketCode": "OVER_UNDER",
      "marketParams": { "side": "OVER", "line": 2.5 },
      "bookmakerApiId": 8,
      "submittedOdds": 1.92
    },
    {
      "apiFixtureId": 1234890,
      "marketCode": "MATCH_WINNER",
      "marketParams": { "side": "HOME" },
      "bookmakerApiId": 8,
      "submittedOdds": 2.10
    }
  ]
}
```

### 27.2 Validate response — happy path

```json
{
  "ok": true,
  "totalOdds": 4.032,
  "accumulatorBonusPercent": 0,
  "potentialWin": 80.64,
  "selections": [
    { "index": 0, "serverOdds": 1.92, "marketState": "OPEN", "live": false },
    { "index": 1, "serverOdds": 2.1, "marketState": "OPEN", "live": false }
  ],
  "freezeWindowSeconds": 3,
  "freezeToken": "8b3c…ac"
}
```

### 27.3 Validate response — drift

```json
{
  "ok": false,
  "code": "odds_changed",
  "selections": [
    {
      "index": 0,
      "submittedOdds": 1.92,
      "serverOdds": 1.85,
      "delta": -0.07,
      "tolerance": 0.02,
      "marketState": "OPEN"
    },
    {
      "index": 1,
      "submittedOdds": 2.1,
      "serverOdds": 2.1,
      "marketState": "OPEN"
    }
  ],
  "newTotalOdds": 3.885,
  "newPotentialWin": 77.7,
  "freezeWindowSeconds": 3,
  "freezeToken": "9c2e…0a"
}
```

### 27.4 Place request (first attempt, no acceptance yet)

```http
POST /api/bets/place
Authorization: Bearer eyJ...
Idempotency-Key: f5b5b8c0-2c8d-4d9e-9c1d-001122334455
Content-Type: application/json

{
  "channel": "WEB",
  "stake": 20,
  "acceptOddsChanges": false,
  "freezeToken": "9c2e…0a",
  "selections": [
    {
      "apiFixtureId": 1234567,
      "marketCode": "OVER_UNDER",
      "marketParams": { "side": "OVER", "line": 2.5 },
      "bookmakerApiId": 8,
      "submittedOdds": 1.85
    },
    {
      "apiFixtureId": 1234890,
      "marketCode": "MATCH_WINNER",
      "marketParams": { "side": "HOME" },
      "bookmakerApiId": 8,
      "submittedOdds": 2.10
    }
  ]
}
```

### 27.5 Place response when odds moved (confirmation required)

```http
HTTP/1.1 409 Conflict
```

```json
{
  "code": "odds_changed",
  "requiresConfirmation": true,
  "message": "Odds changed. Please review and confirm latest odds.",
  "selections": [
    { "index": 0, "submittedOdds": 1.85, "serverOdds": 1.81, "tolerance": 0.0 }
  ],
  "newTotalOdds": 3.801,
  "newPotentialWin": 76.02
}
```

### 27.6 Place request (after explicit user/cashier confirmation)

```http
POST /api/bets/place
Authorization: Bearer eyJ...
Idempotency-Key: f5b5b8c0-2c8d-4d9e-9c1d-001122334455
Content-Type: application/json

{
  "channel": "WEB",
  "stake": 20,
  "acceptOddsChanges": true,
  "freezeToken": "9c2e…0a",
  "selections": [
    {
      "apiFixtureId": 1234567,
      "marketCode": "OVER_UNDER",
      "marketParams": { "side": "OVER", "line": 2.5 },
      "bookmakerApiId": 8,
      "acceptedOdds": 1.81
    },
    {
      "apiFixtureId": 1234890,
      "marketCode": "MATCH_WINNER",
      "marketParams": { "side": "HOME" },
      "bookmakerApiId": 8,
      "acceptedOdds": 2.10
    }
  ]
}
```

### 27.7 Place response

```json
{
  "ticketId": "01HJX...",
  "couponNumber": "ab123456",
  "receiptNumber": "12345-67890",
  "stake": 20,
  "totalOdds": 3.885,
  "potentialWin": 77.7,
  "status": "OPEN",
  "balance": 218.55,
  "channel": "WEB",
  "selections": [
    {
      "fixtureId": "01HJW...",
      "marketCode": "OVER_UNDER",
      "marketParams": { "side": "OVER", "line": 2.5 },
      "odds": 1.81,
      "live": false
    },
    {
      "fixtureId": "01HJV...",
      "marketCode": "MATCH_WINNER",
      "marketParams": { "side": "HOME" },
      "odds": 2.1,
      "live": false
    }
  ]
}
```

### 27.8 Place response — market suspended after validate

```http
HTTP/1.1 409 Conflict
```

```json
{
  "code": "market_suspended",
  "selections": [
    {
      "index": 0,
      "fixtureId": "01HJW...",
      "marketCode": "OVER_UNDER",
      "marketParams": { "side": "OVER", "line": 2.5 }
    }
  ]
}
```

### 27.9 Socket events

```js
// fixture room
io.to(`fixture:${apiFixtureId}`).emit("odds:update", {
  apiFixtureId: 1234567,
  bookmakerApiId: 8,
  markets: [
    {
      marketCode: "OVER_UNDER",
      marketParams: { side: "OVER", line: 2.5 },
      odds: 1.78,
      ts: 1716102345123,
    },
  ],
});

io.to(`fixture:${apiFixtureId}`).emit("market:suspended", {
  apiFixtureId: 1234567,
  marketCode: "OVER_UNDER",
  marketParams: { side: "OVER", line: 2.5 },
});

// per-user room
io.to(`user:${userId}`).emit("ticket:placed", {
  ticketId: "01HJX...",
  status: "OPEN",
  balance: 218.55,
});
```

---

## 28. How major sportsbooks typically handle this

A quick reference, mostly to keep the design honest:

- **Bet365 / William Hill** — slip subscribes to a per-market push channel. Placement is a 2-step `submit` + explicit `confirm` flow when odds drift. Live tickets default to stricter acceptance rules.
- **Pinnacle** — favours the "accept any change" model because their margins are tighter; their API publishes `lineId` per quote and the API will fail with `LINE_NOT_FOUND` if the operator pulled it after the quote was issued.
- **Stake / FanDuel** — same pattern, with idempotency keys at the API boundary (`X-Idempotency-Key`) and a sub-200 ms validation budget for live.
- **All of them** persist the _server-confirmed_ odds, not the _client-submitted_ odds, on the bet record.
- **All of them** require explicit re-confirmation when odds move during placement windows, which matters for legal defensibility and customer dispute handling.

In practice 80% of the "secret sauce" is just the disciplined application of:

- server-trusted prices,
- idempotency,
- per-market suspension,
- socket push,
- and basic exposure controls.

That is exactly what this plan rolls out.

---

## 29. Synchronous vs Asynchronous boundaries

| Step                                              | Sync? | Why                                                           |
| ------------------------------------------------- | :---: | ------------------------------------------------------------- |
| Auth + schema validation                          | sync  | trivial cost, must reject early                               |
| Fixture batch resolution                          | sync  | single indexed Mongo query, sub-10 ms                         |
| Market state lookup                               | sync  | Redis HGET, sub-1 ms                                          |
| Odds lookup                                       | sync  | Redis hash, sub-1 ms; fallback to DB only when cache missing  |
| Stake limits / acca bonus / optional per-user cap | sync  | cheap arithmetic + 1 Mongo query                              |
| Wallet lock acquire                               | sync  | Redis SETNX                                                   |
| `$transaction` (wallet/tx/ticket)                 | sync  | money path — must be atomic                                   |
| Audit log                                         | async | non-blocking; queue if write fails, don't fail the placement  |
| Socket emit                                       | async | fire-and-forget                                               |
| Push notification                                 | async | already done via `notifyUserSafe`                             |
| `syncOdds` / `syncLiveFixtures`                   | async | BullMQ workers                                                |
| Stale fixture re-sync trigger                     | async | enqueue `sync-odds` job when cache miss observed in placement |

---

## 30. Which validations must run immediately before ticket acceptance?

**Must-run inline, in this order, every time:**

1. JWT auth (or anonymous flag).
2. Idempotency replay check.
3. Body schema validation.
4. Fixture existence + status check (NS for pre-match; LIVE for live).
5. Server-side kickoff buffer for pre-match.
6. Market open/suspended/closed check.
7. Server-trusted odds lookup + tolerance check.
8. Stake / max-win / optional per-user cap check.
9. Wallet balance (inside the `$transaction`).

**Can run inline but on a cached value:**

- Bonus configuration.
- Tax snapshot.

**Must NOT run inline:**

- Upstream HTTPS call to API-Sports (always served from cache + DB; queue the refresh).
- Audit log persistence (best-effort).
- Socket emit.

---

## 31. Final Readiness Scorecard

| Capability                        | Score (0–2) |
| --------------------------------- | :---------: |
| Authentication & authorization    |      2      |
| Atomic wallet debit               |     1.5     |
| Idempotency on placement          |      0      |
| Server-trusted odds (pre-match)   |      0      |
| Server-trusted odds (live)        |      0      |
| Market suspension handling        |      0      |
| Kickoff enforcement (server-side) |     0.5     |
| Per-user exposure cap             |     0.5     |
| Real-time odds push (socket)      |      0      |
| Rate limiting                     |      0      |
| Audit log coverage                |      1      |
| Settlement + payout idempotency   |      2      |
| Cashier confirm-print idempotency |      2      |

**Weighted readiness: 3.5 / 10.**

The platform has a clean wallet/transaction substrate (the parts already done are _well_ done — unique references, idempotent payout, audit logging, well-structured Prisma schema, full V2 market registry) but the placement-time validation layer is essentially a stub. Everything in §24 builds on top of the strengths already in the codebase.

---

## 32. Risk Assessment Summary

- **Financial exposure today is bounded only by `MAX_WINNING_AMOUNT`.** If that admin setting is unset for any environment, the platform is theoretically unbounded.
- **The lack of odds revalidation is the single most exploitable surface** — both manually (stale slips) and programmatically (a 30-line script can post any odds).
- **The lack of idempotency is the most likely cause of customer complaints** in production traffic, especially on mobile networks.
- **Lack of socket push** is the biggest **UX** risk — players will leave for a competitor that quotes them honestly in real time.

---

## 33. Critical Missing Features (priority order)

1. Server-side odds revalidation against trusted source (pre-match).
2. Server-side odds revalidation against trusted source (live).
3. Market suspension / closed-line enforcement.
4. Server-enforced kickoff cutoff for the `Fixture` path.
5. Idempotency-Key on `/api/bets/place`.
6. Wallet lock (Redis) around placement.
7. Optional per-user exposure cap.
8. Real-time push of odds/suspension to the slip.
9. Audit log on `/api/bets/place` (currently only `/api/tickets`).
10. Validation re-run at `confirm-print`.
11. Rate limiting on placement endpoints.
12. `Idempotency-Key` mandatory + replayable response cache.
13. `coupon_number @unique` constraint.
14. `Ticket.idempotency_key`, `TicketSelection.server_odds*`, `TicketSelection.market_state` columns.
15. `MarketState` collection + sync worker writes.

---

## 34. Realistic Implementation Scope (Modular Monolith)

This implementation is intentionally scoped for a **mid-scale sportsbook** and a small engineering team.

### Keep

- Modular monolith (Node.js + Express + Prisma)
- Redis for cache/locks/freeze/idempotency replay
- BullMQ workers for all upstream ingestion
- Prisma transactions for money movement
- Socket.IO for real-time odds and state updates
- Centralized odds engine services

### Explicitly avoid (for now)

- Kafka/event-stream overengineering
- Microservice decomposition for placement
- Distributed trading/risk room systems
- Automatic liability-driven odds shifting engines
- Complex trader tooling beyond admin manual controls

### Advanced risk/liability note

Advanced liability balancing, dynamic odds movement by exposure, and trader-room workflows are **future scalability considerations**, not part of this implementation phase.

For current scope, keep:

- basic max stake limits
- basic max winning limits
- optional per-user exposure cap

---

_End of plan — no production code has been modified._
