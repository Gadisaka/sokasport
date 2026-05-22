# Kizzabet admin portal — scope and pages

This document describes what **staff** (non-player) users do in the admin portal, how that maps to the **Kizzabet** platform (shops, cashiers, betting, wallets), and which **pages** the React admin app should provide. It is derived from `backend/docs/database-schema.md`, `backend/lib/permissions.js`, mounted API routes in `backend/index.js`, and the current admin shell in `admin/src`.

---

## What the admin portal is for

The admin portal is the **internal web UI** for operating the betting business: managing people and access, configuring rules, supervising sports and odds, handling money movement and approvals, and supporting tickets and payouts. **End customers (players)** are expected to use a separate player experience; they are not the primary audience here.

The same SPA can serve **multiple staff roles** (Super Admin, Admin, Financial Support, Agent, Cashier). Each role should see only the screens and actions allowed by backend permissions (see below).

---

## Platform context (what staff are managing)


| Area                       | Purpose                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Users & roles**          | Staff accounts (admin, cashier, agent, etc.) and players; enable/disable access.                                 |
| **Branches & cashiers**    | Physical shops; cashiers sell tickets and handle payouts per branch rules.                                       |
| **Wallets & transactions** | Player and cashier floats; deposits, withdrawals, bet/payout/cashout/bonus movements.                            |
| **Sports offering**        | Sports, leagues, matches, markets/odds; match lifecycle (scheduled → live → finished) and results.               |
| **Tickets**                | Bets placed at a branch (and linked cashier); statuses include open, won/lost, void, canceled, paid, cashed out. |
| **Cash out**               | Early settlement of open tickets where the product allows it.                                                    |
| **Bonuses & promotions**   | Configurable bonuses and marketing banners (schema exists; wire when APIs exist).                                |
| **Settings**               | Platform knobs (e.g. ticket cancellation window, betting limits).                                                |
| **Reports & audit**        | Operational and financial reporting; trace sensitive actions (schema/permissions anticipate this).               |


---

## Staff roles and typical responsibilities

Roles are defined in the database and mirrored in `admin/src/constants/auth.js` (`ADMIN_ALLOWED_ROLES`). **Players** must not use this portal (they are excluded from `ADMIN_ALLOWED_ROLES`).

### Super Admin & Admin

- Full operational control: users, configuration, sports/odds, oversight of tickets and financial flows.
- In the backend, both roles have permission wildcard `*` (`backend/lib/permissions.js`), so every guarded admin API is available to them.

### Financial Support

- Focus on **wallet operations and controls**: approve/reject/hold pending wallet requests, fill/deduct cashier floats, inspect wallet history, read reports.
- Permissions: `wallet:`* style actions and `reports:read` (see `ROLE_PERMISSIONS.FINANCIAL_SUPPORT`).

### Agent

- Usually **read-only or oversight** scoped to assigned branches (branch scoping should be enforced in APIs when implemented).
- Permissions: `dashboard:read`, `reports:read`, `tickets:read`, `games:read` — suitable for dashboards, ticket lookup, and viewing the fixture/odds catalog.

### Cashier

- **Day-to-day shop floor**: create tickets, cancel within policy, execute payouts and cash-out, player deposit/withdraw at the counter, view games/odds.
- Permissions: `tickets:`* (create/read/cancel/payout), `cashout:execute`, `wallet:deposit`, `wallet:withdraw`, `games:read`.

> **Note:** Today the admin app only checks “is this a staff role?” on the home route; **per-page permission checks** should be added so Cashiers do not see user-management screens, etc.

---

## Pages — current vs recommended

### Already in the admin app


| Page                    | Route           | Role gate today           | Purpose                                                                       |
| ----------------------- | --------------- | ------------------------- | ----------------------------------------------------------------------------- |
| Login                   | `/login`        | Guest only                | Staff sign-in.                                                                |
| Unauthorized            | `/unauthorized` | Public                    | Shown when a user lacks access (extend for permission-based denials).         |
| Dashboard (placeholder) | `/`             | Any `ADMIN_ALLOWED_ROLES` | Home; should evolve into **role-specific widgets** (queues, KPIs, shortcuts). |


### Recommended pages (map to existing or planned APIs)

Group by domain. Suggested paths are conventional; adjust to match your router.

#### 1. Dashboard

- **Who:** All staff (content differs by role).
- **Why:** Snapshot of pending wallet requests, today’s ticket volume, critical match states, etc.
- **Backend:** Aggregate endpoints may be added; today use combinations of existing list endpoints.

#### 2. Users & access

- **Who:** Super Admin, Admin (and only them in the UI).
- **Why:** List/create/update users; assign roles; activate/deactivate accounts.
- **Backend:** `/api/admin/users` (see `usersController.js`).

#### 3. Platform settings

- **Who:** Super Admin, Admin.
- **Why:** Global settings list, ticket cancellation window, betting limits.
- **Backend:** `/api/admin/settings` (and related GET/PUT documented in `settingsController.js`).

#### 4. Sports & fixtures (games)

- **Who:** Super Admin, Admin (write); Agent/Cashier (read for offering).
- **Why:** Manage matches (status, result), maintain odds/markets for sale.
- **Backend:** `/api/admin/games` (match status/result, odds creation, etc. — see `gameController.js`).

#### 5. Tickets

- **Who:** Cashier (create/cancel/payout); Admin (void/cancel oversight); Agent (read); Financial Support (read as needed for disputes).
- **Why:** Search by coupon/user/branch; open detail; actions per policy (cancel window, void rules).
- **Backend:** `/api/tickets` (ticket lifecycle — see `ticketsController.js`); cancel window via admin settings.

#### 6. Wallets & treasury

- **Who:** Financial Support, Super Admin, Admin.
- **Why:** Pending deposit/withdraw requests (approve/reject/hold); fill/deduct cashier wallet; per-wallet transaction history.
- **Backend:** `/api/admin/wallet` (fill, deduct, history, pending, approve/reject/hold — see `walletController.js`).

#### 7. Cashier counter (player-facing ops at branch)

- **Who:** Cashier (primary).
- **Why:** Quick flows for deposit/withdraw and ticket sale/payout aligned with cashier permissions.
- **Backend:** Same ticket and wallet endpoints; UX can be a dedicated “Counter” page separate from heavy admin tables.

#### 8. Reports

- **Who:** Financial Support, Agent (and Admins).
- **Why:** Branch/agent performance, stakes, payouts, liability — aligned with `reports:read` and cached `Reports` table in schema.
- **Backend:** May need dedicated report routes if not yet present; schema supports cached report rows.

#### 9. Branches & agent assignment

- **Who:** Super Admin, Admin.
- **Why:** Maintain branches, cashiers, and which agent sees which branch (`Agent Branches` in schema).
- **Backend:** **Not** exposed as dedicated routes in `backend/index.js` yet — plan pages after CRUD APIs exist.

#### 10. Bonuses & promotions

- **Who:** Super Admin, Admin (marketing/product).
- **Why:** Configure bonus rules and active promotions/banners.
- **Backend:** Schema includes `Bonuses` and `Promotions`; **admin routes not mounted yet** — plan pages when APIs are added.

#### 11. Audit log

- **Who:** Super Admin, Admin (compliance).
- **Why:** Review `LOGIN`, `CANCEL_TICKET`, `PAYOUT`, `WALLET_UPDATE`, etc.
- **Backend:** `Audit Logs` table in schema; **expose read API and UI when ready**.

---

## Summary checklist


| Priority       | Page / area                               | Primary roles                        |
| -------------- | ----------------------------------------- | ------------------------------------ |
| Done (minimal) | Login, Unauthorized, Dashboard shell      | All staff                            |
| High           | Role-aware Dashboard                      | All staff                            |
| High           | Users                                     | Super Admin, Admin                   |
| High           | Settings                                  | Super Admin, Admin                   |
| High           | Games / matches / odds                    | Admin (write); Cashier, Agent (read) |
| High           | Tickets (list + detail + actions)         | Cashier; Admin; Agent (read)         |
| High           | Wallets (pending + fill/deduct + history) | Financial Support; Admin             |
| Medium         | Reports                                   | Financial Support; Agent; Admin      |
| Medium         | Cashier “counter” UX                      | Cashier                              |
| Later          | Branches & agents                         | Admin                                |
| Later          | Bonuses & promotions                      | Admin                                |
| Later          | Audit log viewer                          | Super Admin, Admin                   |


---

## Implementation notes

1. **Route-level role lists** (like `ProtectedRoute` + `allowedRoles`) work for coarse gates (e.g. “only Admin can open `/users`”). **Fine-grained actions** should match `roleHasPermission` on the server and be reflected in the UI (hide buttons or show read-only).
2. **Cashier vs Agent:** Both currently share `ADMIN_ALLOWED_ROLES`; product-wise, Agent is oversight/reporting, Cashier is transactional — reflect that in navigation and default landing views.
3. This document should be updated when new `/api/admin/`* routes appear (branches, bonuses, audit, reports).

