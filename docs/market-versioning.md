# Market Versioning

## Objective
Market acceptance now compares both price and server-side market version to prevent stale acceptance when odds revert to a previous numeric value.

## Request fields
- `selections[].marketVersion`
- `selections[].acceptedMarketVersion`

## Engine behavior
- `odds_changed`: numeric drift beyond tolerance.
- `market_version_changed`: submitted version differs from server version, even when odds match.

## Live snapshot keys
- `live-market-version:{apiFixtureId}`
- `live-market-updated-at:{apiFixtureId}`

## Persistence
- `TicketSelection.market_version` (submitted/accepted version)
- `TicketSelection.server_market_version` (resolved authoritative version)

