import { prisma } from "../Config/db.js";

function jsonValue(value) {
  if (value == null) return null;
  return value;
}

export async function logPlacementValidation(input = {}) {
  try {
    await prisma.placementValidationLog.create({
      data: {
        actor_user_id: input.actorUserId || null,
        actor_role: input.actorRole || null,
        ticket_id: input.ticketId || null,
        idempotency_key: input.idempotencyKey || null,
        flow_channel: input.flowChannel || "PLAYER",
        is_live: Boolean(input.isLive),
        fixture_ids: Array.isArray(input.fixtureIds) ? input.fixtureIds : [],
        submitted_odds: jsonValue(input.submittedOdds),
        server_odds: jsonValue(input.serverOdds),
        submitted_market_versions: jsonValue(input.submittedMarketVersions),
        server_market_versions: jsonValue(input.serverMarketVersions),
        market_states: jsonValue(input.marketStates),
        rejection_reason: input.rejectionReason || null,
        status: input.status || "SUCCESS",
        validation_latency_ms: Number(input.validationLatencyMs || 0),
        payload: jsonValue(input.payload),
      },
    });
  } catch (error) {
    // logging must never break placement
    console.error("logPlacementValidation error:", error?.message || error);
  }
}

