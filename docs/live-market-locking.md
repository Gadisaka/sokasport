# Live Market Locking

## States
- `OPEN`
- `LOCKED` (temporary freeze)
- `SUSPENDED`
- `CLOSED`

## Lock windows
- `LIVE_MARKET_LOCK_MS` controls lock TTL.
- `LIVE_EVENT_FREEZE_MS` adds an event freeze delay before unlock.

## Worker behavior
`syncLiveFixtures` locks markets during major live transitions (score/state transitions), refreshes snapshots, and unlocks after refresh.

## Redis keys
- `live-market-state:{apiFixtureId}`
- `live-market-lock-until:{apiFixtureId}`

## API behavior
- Placement rejects locked legs with `code: market_locked`.

