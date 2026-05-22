# Wallet Locking

## Purpose
Protect wallet debit operations from concurrent race conditions during bet placement and cashier print confirmation.

## Lock implementation
- Redis key: `wallet:lock:{walletId}`
- Acquire: `SET key token PX ttl NX`
- Release: compare-and-delete Lua script (token ownership safe release)
- Fallback: TTL auto-expiry

## Responses
- On contention: `409` with `code: wallet_busy`

## Metrics
- lock attempts
- lock acquired
- lock busy
- lock errors
- average wait time

