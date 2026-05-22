# Decimal Safety Audit

## Scope audited
- `backend/controllers/ticketsController.js`
- `backend/lib/bonusEngine.js`
- `backend/lib/winningsTax.js`
- `backend/lib/bettingLimits.js`

## Unsafe patterns found
- direct subtraction/addition on wallet balances via `Number`
- tax and accumulator arithmetic using float multiplication
- ad-hoc `toFixed` rounding in placement updates

## Fixes applied
- introduced shared Decimal utility: `backend/lib/moneyDecimal.js`
- wallet debit paths now use Decimal-based subtraction and money rounding
- winnings tax and bonus engine round through Decimal helpers

## Remaining risk
- DB numeric fields are still `Float`; persistence-level binary float drift is still possible on edge values.
- Full Decimal column migration is recommended as a follow-up migration phase.

## Regression test strategy
- large accumulator chain precision
- tiny decimal odds stability
- tax breakdown rounding
- wallet debit/credit round-trip checks

