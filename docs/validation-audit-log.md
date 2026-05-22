# Validation Audit Log

## Model
`PlacementValidationLog` captures placement and validation outcomes with payload-level observability.

## Captured fields
- actor user/role
- ticket id
- idempotency key
- fixture ids
- submitted vs server odds
- submitted vs server market versions
- market states
- rejection reason
- validation latency
- status (`SUCCESS`/`REJECTED`)
- request/response payload snapshot

## Admin access
- `GET /api/admin/validation/placement-logs`
- filters: reason, actorUserId, actorRole, fixtureId, page, limit

