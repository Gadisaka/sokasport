# Porting API-Football fetching from this backend

This document lists what to copy from the MezzoBet `backend` and how to wire it into a **new** Node.js project. The “API fetching feature” here means integration with **API-Sports Football** (`v3.football.api-sports.io`): HTTP client, optional odds parsing, optional Redis caching, and optional cron jobs that persist data via Prisma.

---

## Choose a scope

| Scope | What you get | Typical use |
| ----- | ------------ | ----------- |
| **A – HTTP client only** | Typed-ish functions: `getLeagues`, `getTeams`, `getFixtures`, `getOdds`, `getLiveFixtures`, rate-limit handling, daily call cap | Microservice or script that only calls the external API |
| **A + B** | Add normalized odds structures from raw API responses | Same as A, but you consume `parseMarkets` / `flattenOdds` instead of raw JSON |
| **A + B + C** | Add Redis read/write helpers used by jobs and API cache | Any app that wants the same cache keys and TTLs |
| **Full pipeline (A+B+C+D)** | Cron jobs that upsert leagues, teams, fixtures, odds, live updates into MongoDB | Drop-in ingestion similar to this repo |

---

## Files and folders to copy

Paths are relative to the repository root `mezzobet/backend/`.

### Scope A – HTTP client only (minimum)

| Path | Role |
| ---- | ---- |
| `services/apiFootballService.js` | Axios client, `request()` wrapper, exports `getLeagues`, `getTeams`, `getFixtures`, `getOdds`, `getLiveFixtures`, `sleep`, `getDailyCallCount` |

**npm dependencies:** `axios`  
**Environment:** `API_FOOTBALL_KEY` (see below)

---

### Scope A + B – Add odds parsing

| Path | Role |
| ---- | ---- |
| `services/apiFootballService.js` | (same as A) |
| `utils/oddsParser.js` | `parseMarkets(rawOddsResponse)`, `flattenOdds(parsed)` — filters bet IDs 1, 5, 8, 12 |

**npm dependencies:** `axios` only (parser is pure JS)

---

### Scope A + B + C – Add Redis caching

| Path | Role |
| ---- | ---- |
| `services/apiFootballService.js` | |
| `utils/oddsParser.js` | |
| `services/cacheService.js` | `getCache`, `setCache`, `deleteCache`, `TTL` constants |

**npm dependencies:** `axios`, `ioredis`  
**Environment:** `REDIS_URL` (optional; defaults to `redis://localhost:6379`)

---

### Full pipeline – Cron + Prisma + MongoDB

Copy everything in scopes A+B+C, plus:

| Path | Role |
| ---- | ---- |
| `jobs/syncLeagues.js` | Fetches leagues, upserts `Sport` / `League`, sets `leagues:all` cache |
| `jobs/syncTeams.js` | Fetches teams per active league, upserts `Team`, clears `teams:league:{id}` cache |
| `jobs/syncFixtures.js` | Fetches fixtures by date window, upserts `Fixture`, sets `fixtures:league:{id}` cache |
| `jobs/syncOdds.js` | Fetches odds for upcoming fixtures, upserts `Bookmaker` / `Market` / `Odd`, caches parsed odds |
| `jobs/syncLiveFixtures.js` | Live fixtures, score updates, optional odds refresh + `live:fixtures` cache |
| `jobs/index.js` | `startCronJobs()` — registers all schedules with `node-cron` |
| `config/db.js` | Default export: `new PrismaClient()` |

**Prisma schema (ingestion-related models only):**  
You do **not** need the entire `schema.prisma` if your new app has no users/bets. Minimum models and enum used by the jobs:

- Enum: `FixtureStatus`
- Models: `Sport`, `League`, `Team`, `Fixture`, `Market`, `Odd`, `Bookmaker`

Copy the corresponding blocks from `prisma/schema.prisma` (lines ~98–230 in the current file), adjust `generator` / `datasource` for your DB URL, then run `npx prisma generate`.

**npm dependencies:** `axios`, `ioredis`, `@prisma/client`, `prisma`, `node-cron`, `dotenv` (if you load `.env` at startup)

**Environment:** `DATABASE_URL`, `API_FOOTBALL_KEY`, `REDIS_URL`

---

### Optional reference (not required to “fetch”)

These read from DB/cache and expose HTTP; copy only if your new system is another Express app with the same routes:

- `controllers/league.controller.js`, `controllers/fixture.controller.js`, `controllers/odds.controller.js`
- `routes/league.route.js`, `routes/fixture.route.js`, `routes/odds.route.js`

Background documentation that describes the same system (schedules in that doc may differ slightly from `jobs/index.js`; trust the code in `jobs/index.js` for cron timing):

- `DATA_INGESTION.md`

---

## Environment variables

Create a `.env` in the new project (or inject these in your host):

| Variable | Required for | Description |
| -------- | ------------ | ----------- |
| `API_FOOTBALL_KEY` | A | API-Sports key; sent as header `x-apisports-key` |
| `REDIS_URL` | C, full pipeline | Redis connection string |
| `DATABASE_URL` | Full pipeline | MongoDB URL for Prisma (`provider = "mongodb"` in this repo) |

---

## New project setup (step by step)

### 1. Initialize Node and ESM

This codebase uses **ES modules** (`"type": "module"` in `package.json`). In the new project, set:

```json
{
  "type": "module",
  "dependencies": {
    "axios": "^1.13.6"
  }
}
```

Add `ioredis`, `@prisma/client`, `prisma`, `node-cron`, `dotenv` as needed for scopes C and D.

### 2. Fix import paths

After copying files, either:

- Keep the same folder layout (`services/`, `utils/`, `jobs/`, `config/`), or  
- Update every `import ... from "../services/..."` to match your structure.

### 3. Scope A – Call the API from your own code

```javascript
import "dotenv/config";
import {
  getLeagues,
  getTeams,
  getFixtures,
  getOdds,
  getLiveFixtures,
} from "./services/apiFootballService.js";

// Example: leagues (raw API shape)
const leagues = await getLeagues();

// Example: teams for league 39, season 2024
const teams = await getTeams(39, 2024);

// Example: fixtures for one league/day
const fixtures = await getFixtures(39, 2024, "2026-04-11");

// Example: odds for API fixture id
const rawOdds = await getOdds(1234567);

// Example: all live fixtures (API “live=all”)
const live = await getLiveFixtures();
```

**Behavior to be aware of:**

- On HTTP/network failure or API `errors` object (except rate limit), functions return **`[]`** (empty array), not thrown errors.
- **Rate limit:** if `data.errors.rateLimit` is set, the client waits **7 seconds** and retries the same request once (recursive).
- **Daily cap:** in-process counter `DAILY_CALL_LIMIT` (75000); when exceeded, `request()` returns `[]` without calling the network.

### 4. Scope B – Normalize odds

```javascript
import { parseMarkets, flattenOdds } from "./utils/oddsParser.js";

const raw = await getOdds(fixtureApiId);
const parsed = parseMarkets(raw);
// parsed: { fixtureId?, bookmakers: [{ apiBookmakerId, name, markets: [{ name, values: [{ value, odd }] }] }] }

const rows = flattenOdds(parsed);
// rows: flat list for spreadsheets or simple DB inserts
```

Supported API bet IDs: **1** (Match Winner), **5** (Over/Under), **8** (BTTS), **12** (Double Chance). Extend `MARKET_MAP` in `oddsParser.js` if you need more.

### 5. Scope C – Redis

```javascript
import { getCache, setCache, deleteCache, TTL } from "./services/cacheService.js";

const key = "odds:fixture:1234567";
let data = await getCache(key);
if (!data) {
  data = await fetchAndParseSomehow();
  await setCache(key, data, TTL.ODDS);
}
await deleteCache(key);
```

`TTL` values are in seconds (`LEAGUES`, `TEAMS`, `FIXTURES`, `ODDS`, `LIVE`).

### 6. Full pipeline – Prisma + cron

1. Copy the ingestion models into `prisma/schema.prisma`, set `DATABASE_URL`, run:

   ```bash
   npx prisma generate
   ```

2. Ensure `config/db.js` exists and jobs import it as `import prisma from "../config/db.js"` (adjust path if your `config` folder moves).

3. From your app entry (equivalent of `index.js`):

   ```javascript
   import "dotenv/config";
   import { startCronJobs } from "./jobs/index.js";

   startCronJobs();
   ```

**Schedules in `jobs/index.js` (current code):**

| Job | Cron expression | Meaning |
| --- | ---------------- | ------- |
| `syncLeagues` | `0 3 * * *` | Daily 03:00 |
| `syncTeams` | `0 4 * * *` | Daily 04:00 |
| `syncFixtures` | `*/30 * * * *` | Every 30 minutes |
| `syncOdds` | `*/2 * * * *` | Every 2 minutes |
| `syncLiveFixtures` | `*/30 * * * * *` | Every 30 seconds |

**`syncLeagues` league filter:** only API league IDs **39, 140, 2, 135, 78, 61** (see `TARGET_LEAGUES` in `syncLeagues.js`). Change that `Map` for other competitions.

**`syncTeams` season quirk:** uses `Math.min(league.season ?? 2024, 2024)` — update for future seasons if you port verbatim.

**`syncFixtures` date window:** `FREE_PLAN_DAYS = 2` (today + next day). Increase if your API plan allows more history/future range.

---

## External API reference (implemented in code)

| Method in service | HTTP | Notes |
| ----------------- | ---- | ----- |
| `getLeagues()` | `GET /leagues` | |
| `getTeams(leagueId, season)` | `GET /teams` | Query: `league`, `season` |
| `getFixtures(leagueId, season, date)` | `GET /fixtures` | Query: `league`, optional `season`, optional `date` (YYYY-MM-DD) |
| `getOdds(fixtureId)` | `GET /odds` | Query: `fixture` |
| `getLiveFixtures()` | `GET /fixtures` | Query: `live=all` |

Base URL: `https://v3.football.api-sports.io`  
Auth: header `x-apisports-key: <API_FOOTBALL_KEY>`

Official docs: [API-Sports Football documentation](https://www.api-football.com/documentation-v3).

---

## Quick copy checklist

**Minimal (call API only):**

- [ ] `services/apiFootballService.js`
- [ ] `axios`, `API_FOOTBALL_KEY`, ESM

**+ Odds parsing:**

- [ ] `utils/oddsParser.js`

**+ Redis:**

- [ ] `services/cacheService.js`
- [ ] `ioredis`, `REDIS_URL`

**+ Full ingestion:**

- [ ] `jobs/*.js` (all five sync files + `index.js`)
- [ ] `config/db.js`
- [ ] Prisma schema slice: `FixtureStatus`, `Sport`, `League`, `Team`, `Fixture`, `Market`, `Odd`, `Bookmaker`
- [ ] `@prisma/client`, `prisma`, `node-cron`, `DATABASE_URL`, migrate/generate as needed

---

## Summary

- The **core** of API fetching is **`services/apiFootballService.js`** plus **`axios`** and **`API_FOOTBALL_KEY`**.
- **`utils/oddsParser.js`** is optional and depends only on the shape of `/odds` responses.
- **`services/cacheService.js`** is optional and mirrors how this app avoids duplicate calls and speeds up reads.
- The **jobs** layer ties fetching to **Prisma/MongoDB** and **Redis**; port it only if you want the same automated ingestion, and bring the listed Prisma models (or adapt the jobs to your own schema).
