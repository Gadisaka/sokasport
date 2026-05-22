# Ticket Engine

## Overview

The ticket engine manages betting tickets, outcomes, and payouts.

---

## Ticket Creation

A ticket contains:

- couponNumber
- stake
- odds
- matches
- cashierId
- branchId
- createdAt

---

## Ticket Status

Possible statuses:

- OPEN
- WON
- LOST
- VOID
- CANCELED
- PAID
- CASHED_OUT

---

## Ticket Operations

### Create Ticket

Triggered when:

- Player places bet
- Cashier sells ticket

---

### Cancel Ticket

Allowed if:

- Match has not started
- Within cancellation window

Admin controls cancellation time via Settings (`TICKET_CANCEL_WINDOW_MINUTES`): `GET /api/admin/settings/ticket-cancel-window` and `PUT /api/admin/settings/ticket-cancel-window`.

---

### Void Ticket

Admin may void ticket in special cases.

---

### Payout Ticket

Validation rules:

- Ticket status = WON
- Ticket not already paid
- Correct cashier processing payout

---

## Payout Rule

Winning tickets must be paid **only at the cashier that sold the ticket**.

Validation:
ticket.sellerCashierId === currentCashierId

If false → payout rejected.
