/**
 * Normalizes the several score buckets an API-Sports fixture payload carries
 * into the values persisted on the `Fixture` row.
 *
 * API-Sports returns TWO distinct full-match scores:
 *   - `goals`            — the running / final total, which on an `AET` game
 *                          INCLUDES extra-time goals (e.g. 1-1 at 90', 2-1 after ET).
 *   - `score.fulltime`   — the score at the 90' whistle (regulation only).
 * plus `score.extratime` (cumulative after ET) and `score.penalty` (shootout).
 *
 * Match Winner and every other full-time market must settle on the 90'
 * regulation score, NOT the extra-time-inclusive `goals`. So for TERMINAL
 * fixtures we prefer `score.fulltime`; while the game is live (incl. during ET,
 * where `score.fulltime` is already frozen at 90') we keep the running `goals`
 * so the displayed/in-play score stays correct.
 *
 * @module jobs/lib/fixtureScores
 */

function toIntOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * @param {object} entry - Raw API-Sports fixture entry (`{ fixture, goals, score }`).
 * @param {{ preferFullTime?: boolean }} [options]
 *   `preferFullTime` — use the 90' regulation score (`score.fulltime`) as the
 *   persisted home/away score. Set this for TERMINAL fixtures; leave false for
 *   live/in-play so the running `goals` score is kept.
 * @returns {{
 *   homeScore: number|null, awayScore: number|null,
 *   etHome: number|null, etAway: number|null,
 *   penHome: number|null, penAway: number|null,
 * }}
 */
export function resolveFixtureScores(entry, { preferFullTime = false } = {}) {
  const goals = entry?.goals ?? entry?.scores ?? {};
  const score = entry?.score ?? {};
  const ft = score.fulltime ?? {};
  const et = score.extratime ?? {};
  const pen = score.penalty ?? {};

  const ftHome = toIntOrNull(ft.home);
  const ftAway = toIntOrNull(ft.away);
  const goalsHome = toIntOrNull(goals.home);
  const goalsAway = toIntOrNull(goals.away);

  // Prefer the 90' regulation score for terminal fixtures, but only when the
  // provider actually reported it; otherwise fall back to `goals` (some
  // terminal payloads omit `score.fulltime`, and a plain FT game has them equal).
  const useFullTime = preferFullTime && ftHome != null && ftAway != null;

  return {
    homeScore: useFullTime ? ftHome : goalsHome ?? ftHome,
    awayScore: useFullTime ? ftAway : goalsAway ?? ftAway,
    etHome: toIntOrNull(et.home),
    etAway: toIntOrNull(et.away),
    penHome: toIntOrNull(pen.home),
    penAway: toIntOrNull(pen.away),
  };
}
