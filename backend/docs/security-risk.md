# Security & Risk Control

## Audit Logs

All important actions must be logged.

Examples:

- Login
- Ticket cancellation
- Wallet operations
- Admin actions

---

## Role Validation

Every API request must verify role permissions.

---

## Wallet Tracking

Track every wallet movement.

Prevent:

- Duplicate payments
- Unauthorized transactions

---

## Fraud Detection

System must detect:

- Suspicious bets
- Abnormally large payouts
- Repeated ticket cancellations

---

## Cash Out Protection

Security rules:

- Cash out calculated on server
- Validate ticket status
- Validate match status
- Validate odds availability

---

## Risk Limits

System must enforce:

- Maximum payout per ticket
- Maximum cash out amount
- Minimum odds
- Minimum number of matches

---

## Delay Mechanism

Cash out requests include a configurable delay to prevent abuse.

- Configured by Admin
- Global setting (applies to all cash out requests)
- Typical range: 2–5 seconds
