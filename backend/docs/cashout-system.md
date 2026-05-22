# Cash Out System

## Overview

Cash Out allows players to receive money before all matches finish.

---

## Cash Out Formula

Cash Out = Stake × Current Odds × System Margin

**Current Odds:** Product of odds for matches already won. Does not include pending or lost matches.

Example: 6 games in total, 3 completed and won with odds 1.5, 1.8, 2.0 respectively → Current Odds = 1.5 × 1.8 × 2.0 = 5.4

**System Margin:** Set by Admin (0.1 – 0.9). Lower margin = less payout to player; higher margin = more payout to player.

---

## Cash Out Flow

- Ticket closes
- Status becomes CASHED_OUT
- Player receives payout

---

## Cash Out Availability

Allowed when:

- Ticket valid
- Odds available
- Match ongoing

Not allowed when:

- Match suspended
- Ticket lost
- Ticket already won
- Ticket already paid

---

## Ticket Buyer Cash Out Rule

For tickets purchased through a cashier:

Conditions:

- Minimum 3 matches won
- No live matches
- 30 minutes after last match ended

---

## Cashier Permissions

Allowed:

- View cash out
- Execute cash out
- Print receipt

Not allowed:

- Edit cash out value
- Override calculation

