# Database Schema

## Overview

This document defines the core database structure for the betting platform.

Main modules:

- Users & Roles
- Wallet System
- Betting Tickets
- Sports & Matches
- Cash Out System
- Bonuses & Promotions
- Transactions
- Branch & Cashier System
- Reports

Database recommendation:

PostgreSQL / MySQL

---

# 1. Roles Table

Stores role definitions.

| Field       | Type      | Description      |
| ----------- | --------- | ---------------- |
| id          | uuid      | Primary key      |
| name        | string    | Role name        |
| description | text      | Role description |
| created_at  | timestamp | Created date     |

Example roles:

- SUPER_ADMIN
- ADMIN
- FINANCIAL_SUPPORT
- AGENT
- CASHIER
- PLAYER

---

# 2. Users Table

Stores all registered users.

| Field      | Type      | Description       |
| ---------- | --------- | ----------------- |
| id         | uuid      | User ID           |
| role_id    | uuid      | Role reference    |
| name       | string    | Full name         |
| email      | string    | Email             |
| phone      | string    | Phone             |
| password   | string    | Hashed password   |
| status     | boolean   | Active / Disabled |
| created_at | timestamp | Created date      |

---

# 3. Branches Table

Physical betting shop branches.

| Field      | Type      |
| ---------- | --------- |
| id         | uuid      |
| name       | string    |
| location   | string    |
| created_at | timestamp |

---

# 4. Cashiers Table

Cashier accounts.

| Field      | Type      |
| ---------- | --------- |
| id         | uuid      |
| user_id    | uuid      |
| branch_id  | uuid      |
| wallet_id  | uuid      |
| status     | boolean   |
| created_at | timestamp |

---

# 4b. Agent Branches Table

Assigns agents to branches (for report access control).

| Field      | Type      |
| ---------- | --------- |
| id         | uuid      |
| agent_id   | uuid      |
| branch_id  | uuid      |
| created_at | timestamp |

---

# 5. Wallets Table

Stores wallet balances.

| Field       | Type    |
| ----------- | ------- |
| id          | uuid    |
| user_id     | uuid    |
| balance     | decimal |
| wallet_type | enum    |

Wallet types:

- PLAYER
- CASHIER

---

# 6. Transactions Table

All wallet transactions.

| Field          | Type      |
| -------------- | --------- |
| id             | uuid      |
| wallet_id      | uuid      |
| type           | enum      |
| amount         | decimal   |
| balance_before | decimal   |
| balance_after  | decimal   |
| reference      | string    |
| created_at     | timestamp |

Transaction types:

- DEPOSIT
- WITHDRAW
- BET
- PAYOUT
- CASHOUT
- BONUS

---

# 7. Sports Table

Available sports.

| Field | Type   |
| ----- | ------ |
| id    | uuid   |
| name  | string |
| icon  | string |

Examples:

- Football
- Tennis
- Basketball

---

# 8. Leagues Table

Sports leagues.

| Field    | Type   |
| -------- | ------ |
| id       | uuid   |
| sport_id | uuid   |
| name     | string |
| country  | string |

---

# 9. Matches Table

Sports matches.

| Field      | Type      |
| ---------- | --------- |
| id         | uuid      |
| league_id  | uuid      |
| home_team  | string    |
| away_team  | string    |
| start_time | timestamp |
| status     | enum      |
| result     | string    |

Match statuses:

- NOT_STARTED
- LIVE
- FINISHED
- SUSPENDED

---

# 10. Odds Table

Betting markets and odds.

| Field     | Type    |
| --------- | ------- |
| id        | uuid    |
| match_id  | uuid    |
| market    | string  |
| selection | string  |
| odds      | decimal |
| status    | boolean |

Example markets:

- Match Winner
- Over/Under
- Both Teams Score

---

# 11. Tickets Table

Main betting ticket.

| Field         | Type                              |
| ------------- | --------------------------------- |
| id            | uuid                              |
| coupon_number | string                            |
| user_id       | uuid (nullable for ticket buyers) |
| cashier_id    | uuid                              |
| branch_id     | uuid                              |
| stake         | decimal                           |
| total_odds    | decimal                           |
| potential_win | decimal                           |
| status        | enum                              |
| created_at    | timestamp                         |

Ticket statuses:

- OPEN
- WON
- LOST
- VOID
- CANCELED
- PAID
- CASHED_OUT
- CASHBACK_PAID

---

# 12. Ticket Selections Table

Each match inside a ticket.

| Field     | Type    |
| --------- | ------- |
| id        | uuid    |
| ticket_id | uuid    |
| match_id  | uuid    |
| selection | string  |
| odds      | decimal |
| result    | enum    |

Selection result:

- PENDING
- WON
- LOST
- VOID

---

# 13. Cash Out Table

Stores cash out operations.

| Field        | Type      |
| ------------ | --------- |
| id           | uuid      |
| ticket_id    | uuid      |
| amount       | decimal   |
| processed_by | uuid      |
| created_at   | timestamp |

---

# 14. Bonuses Table

Stores bonus configurations.

| Field       | Type      |
| ----------- | --------- |
| id          | uuid      |
| name        | string    |
| type        | enum      |
| percentage  | decimal   |
| min_deposit | decimal   |
| status      | boolean   |
| created_at  | timestamp |

Bonus types:

- WELCOME (Registration bonus — same as Registration)
- FIRST_DEPOSIT
- DEPOSIT
- ACCUMULATOR
- CASHBACK
- REFERRAL

---

# 15. Promotions Table

Marketing promotions.

| Field       | Type    |
| ----------- | ------- |
| id          | uuid    |
| title       | string  |
| description | text    |
| banner      | string  |
| active      | boolean |

---

# 16. Audit Logs Table

System activity tracking.

| Field      | Type      |
| ---------- | --------- |
| id         | uuid      |
| user_id    | uuid      |
| action     | string    |
| module     | string    |
| data       | json      |
| created_at | timestamp |

Example actions:

- LOGIN
- CREATE_TICKET
- CANCEL_TICKET
- PAYOUT
- WALLET_UPDATE

---

# 17. Reports Table

Cached reporting data.

| Field        | Type      |
| ------------ | --------- |
| id           | uuid      |
| type         | string    |
| data         | json      |
| generated_at | timestamp |

---

# 18. Settings Table

Admin-configurable platform key-value settings (e.g. ticket cancellation window in minutes).

| Field       | Type      |
| ----------- | --------- |
| id          | uuid      |
| key         | string    |
| value       | string    |
| updated_at  | timestamp |

Example keys:

- `TICKET_CANCEL_WINDOW_MINUTES` — minutes after ticket creation during which cancel is allowed

---

# Important Relationships

Users → Roles

Users → Wallet

Cashiers → Branch

Agents → Branches (via Agent Branches)

Tickets → Cashier

Tickets → Ticket Selections

Matches → Odds

Tickets → Cash Out

Wallet → Transactions

---

# Special Rule: Ticket Buyers (No Account)

For cashier-sold tickets:

user_id = NULL

These tickets are tracked using:

coupon_number

---

# Special Rule: Payout Restriction

Winning tickets must only be paid at the selling cashier.

Validation:

ticket.cashier_id == current_cashier_id

If false → reject payout.

---

# Performance Optimization

Recommended indexes:

tickets.coupon_number

matches.start_time

transactions.wallet_id

ticket_selections.match_id

cashout.ticket_id
