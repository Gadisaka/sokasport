# Sportsbook Rate Limiting

## Protected endpoints
- `POST /api/bets/validate`
- `POST /api/bets/place`
- `PATCH /api/tickets/:id/confirm-print`

## Strategy
- Redis fixed window buckets by scope + actor type + actor id.
- Actor classes: anonymous, authenticated player, cashier, admin.

## Error contract
```json
{
  "code": "rate_limited",
  "retryAfterSeconds": 12
}
```

## Telemetry
- total requests
- blocked requests
- per-scope usage
- per-actor-type usage
- top blocked actors

