/**
 * Registry of all API-Sports providers supported by the platform.
 *
 * Each provider describes the base URL of its API-Sports host and the env var
 * holding the API key. To enable a provider at runtime add its slug to the
 * comma-separated `ENABLED_SPORTS` env var (e.g. `ENABLED_SPORTS=football`).
 *
 * Adding a new sport = add an entry here + set its API key env var. The rest
 * of the ingestion pipeline (jobs, HTTP client) automatically picks it up.
 */

/**
 * API-Sports endpoint differences:
 *   - football uses `/fixtures` and a "live=all" param.
 *   - basketball/baseball/hockey/rugby/american-football use `/games`
 *     and expose live-in-progress via separate params.
 * `fixturesEndpoint` lets the shared client stay generic.
 */
export const SPORT_PROVIDERS = {
  football: {
    slug: "football",
    name: "Football",
    baseURL: "https://v3.football.api-sports.io",
    apiKeyEnv: "API_FOOTBALL_KEY",
    fixturesEndpoint: "/fixtures",
  },
  basketball: {
    slug: "basketball",
    name: "Basketball",
    baseURL: "https://v1.basketball.api-sports.io",
    apiKeyEnv: "API_BASKETBALL_KEY",
    fixturesEndpoint: "/games",
  },
  baseball: {
    slug: "baseball",
    name: "Baseball",
    baseURL: "https://v1.baseball.api-sports.io",
    apiKeyEnv: "API_BASEBALL_KEY",
    fixturesEndpoint: "/games",
  },
  hockey: {
    slug: "hockey",
    name: "Hockey",
    baseURL: "https://v1.hockey.api-sports.io",
    apiKeyEnv: "API_HOCKEY_KEY",
    fixturesEndpoint: "/games",
  },
  rugby: {
    slug: "rugby",
    name: "Rugby",
    baseURL: "https://v1.rugby.api-sports.io",
    apiKeyEnv: "API_RUGBY_KEY",
    fixturesEndpoint: "/games",
  },
  "american-football": {
    slug: "american-football",
    name: "American Football",
    baseURL: "https://v1.american-football.api-sports.io",
    apiKeyEnv: "API_AMERICAN_FOOTBALL_KEY",
    fixturesEndpoint: "/games",
  },
};

const DEFAULT_ENABLED = "football";

export function getEnabledSports() {
  const raw = process.env.ENABLED_SPORTS || DEFAULT_ENABLED;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .filter((slug) => {
      if (!SPORT_PROVIDERS[slug]) {
        console.warn(
          `[sportsRegistry] unknown sport in ENABLED_SPORTS: "${slug}" – ignoring`,
        );
        return false;
      }
      return true;
    });
}

export function isSportEnabled(slug) {
  return getEnabledSports().includes(slug);
}

export function getProviderConfig(slug) {
  const cfg = SPORT_PROVIDERS[slug];
  if (!cfg) return null;
  return { ...cfg, apiKey: process.env[cfg.apiKeyEnv] || null };
}

export function getEnabledProviders() {
  return getEnabledSports()
    .map((slug) => getProviderConfig(slug))
    .filter((cfg) => {
      if (!cfg.apiKey) {
        console.warn(
          `[sportsRegistry] ${cfg.slug} is enabled but ${cfg.apiKeyEnv} is not set – skipping`,
        );
        return false;
      }
      return true;
    });
}
