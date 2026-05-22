# Wallet System

## Overview

The platform operates with two main wallet types:

1. Player Wallet (online users only)
2. Cashier Wallet

Admins control all wallet operations.

**Important:** Online players use their own wallet for deposits, withdrawals, bets, and payouts. Cashier wallet flows apply only to offline tickets (sold and paid at physical branches).

---

## Player Wallet

For registered online users only.

Functions:

- Deposit
- Withdraw
- Place bets (stake deducted)
- Receive winnings (payout credited)
- View transaction history

Limits:

- Minimum deposit
- Maximum deposit
- Minimum withdraw
- Maximum withdraw

Configured by Admin.

---

## Cashier Wallet

Used for offline ticket operations at physical branches.

**Ticket sale:** Recorded on the selling cashier's wallet. Cashier wallet **decreases** (stake comes out of their float).

**Winning payout:** When the cashier pays an offline ticket holder (player with no account), the cashier's wallet **increases** (reimbursement from the system). The cashier pays the winner from their till, then the system credits their wallet.

**Admin settlement:** When the cashier collects physical cash from Admin (bank transfer, etc.), Admin **decreases** the cashier's wallet.

### Flow Summary

1. Cashier sells ticket → Wallet decreases (stake)
2. Cashier pays winning ticket holder → Wallet increases (reimbursement)
3. Admin pays cashier (bank/settlement) → Wallet decreases

### Admin Controls

Admin can:

- Fill wallet (initial float / top-up)
- Deduct wallet (settlement when paying cashier via bank)
- View wallet history
- Monitor transactions

---

## Transaction Tracking

Each wallet transaction must record:

- transactionId
- userId
- cashierId
- type
- amount
- balanceBefore
- balanceAfter
- timestamp

