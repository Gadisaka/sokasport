/**
 * Shared live-fixture status mapping + change detection.
 *
 * Extracted from `syncLiveFixtures.js` so the 60s odds poller and the fast
 * score poller compute IDENTICAL status/change results — divergence would make
 * the two pollers oscillate (each seeing the other's value as a change) or, at
 * worst, lock a fixture forever. Keep the mapped outputs consistent with
 * `LIVE_FIXTURE_STATUSES` in services/odds-engine/marketState.js.
 */

// Raw API-Sports short codes → stored in-play status.
export const STATUS_MAP = {
  "1H": "LIVE",
  HT: "HT",
  "2H": "LIVE",
  ET: "LIVE",
  BT: "LIVE",
  P: "PEN",
  LIVE: "LIVE",
};

// In-play states whose transition is "major" enough to freeze the market.
export const MAJOR_LIVE_STATES = new Set(["HT", "LIVE", "PEN"]);

/**
 * Map a raw API short code to the stored status. Unknown codes fall back to
 * "LIVE" (same default the poller used inline).
 */
export function mapApiStatus(short) {
  return STATUS_MAP[short] ?? "LIVE";
}

/**
 * Pure change detector — mirrors the exact formula the slow poller computes
 * inline (scoreChanged / statusChanged / statusBecameLive / majorStateChanged /
 * shouldFreeze). `prev` and `next` are `{ homeScore, awayScore, status }`.
 */
export function detectChange(prev, next) {
  const scoreChanged =
    prev.homeScore !== next.homeScore || prev.awayScore !== next.awayScore;
  const statusChanged = prev.status !== next.status;
  const statusBecameLive = prev.status === "NS" && next.status === "LIVE";
  const majorStateChanged =
    statusChanged &&
    (MAJOR_LIVE_STATES.has(prev.status) || MAJOR_LIVE_STATES.has(next.status));
  const shouldFreeze = scoreChanged || majorStateChanged;
  return {
    scoreChanged,
    statusChanged,
    statusBecameLive,
    majorStateChanged,
    shouldFreeze,
  };
}
