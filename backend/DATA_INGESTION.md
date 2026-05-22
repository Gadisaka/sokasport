# Data Ingestion Layer

Sports data ingestion system for the Mezzo Bet platform. Fetches fixtures, leagues, teams, and odds from API-Football, caches them in Redis, and stores them in MongoDB via Prisma.

---

## Architecture

```
                    ┌──────────────────┐
                    │  API-Football    │
                    │  External API    │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  Cron Jobs       │
                    │  (node-cron)     │
                    │                  │
                    │  syncLeagues     │  daily 3 AM
                    │  syncTeams       │  daily 4 AM
                    │  syncFixtures    │  every 10 min
                    │  syncOdds        │  every 15 sec
                    │  syncLive        │  every 10 sec
                    └──┬──────────┬────┘
                       │          │
              ┌────────▼──┐  ┌───▼──────────┐
              │  Redis    │  │  MongoDB     │
              │  Cache    │  │  (Prisma)    │
              └────────┬──┘  └───┬──────────┘
                       │         │
                    ┌──▼─────────▼──┐
                    │  Express API  │
                    │  Endpoints    │
                    └───────────────┘
                          │
                    ┌─────▼─────┐
                    │  Frontend │
                    └───────────┘
```

---

## Environment Variables

Add these to `backend/.env`:

| Variable           | Description                          | Example                        |
| ------------------ | ------------------------------------ | ------------------------------ |
| `DATABASE_URL`     | MongoDB connection string            | `mongodb+srv://...`            |
| `API_FOOTBALL_KEY` | API-Football API key                 | `abc123...`                    |
| `REDIS_URL`        | Redis connection URL                 | `redis://localhost:6379`       |

---

## Database Models

### Sport
Root entity for multi-sport support.

### League
Leagues fetched from API-Football. Linked to a Sport. Stores `apiLeagueId` for external reference.

**Target leagues:**
- Premier League (39)
- La Liga (140)
- Champions League (2)
- Serie A (135)
- Bundesliga (78)
- Ligue 1 (61)

### Team
Teams within a league. Stores `apiTeamId`, name, and logo URL.

### Fixture
Individual matches. Links to league, home team, and away team. Tracks score and status (NS, LIVE, HT, FT, etc.).

### Market
Betting markets for a fixture (e.g., Match Winner, Over/Under, BTTS, Double Chance).

### Odd
Individual odds within a market, linked to a bookmaker. Stores the label (`value`) and decimal odds (`odd`).

### Bookmaker
Bookmaker source for odds data.

---

## API Endpoints

| Method | Path                    | Description                |
| ------ | ----------------------- | -------------------------- |
| GET    | `/api/leagues`          | All active leagues         |
| GET    | `/api/fixtures/today`   | Today's fixtures           |
| GET    | `/api/fixtures/live`    | Currently live fixtures    |
| GET    | `/api/odds/:fixtureId`  | Odds for a fixture (by API fixture ID) |

All endpoints follow a **cache-first** pattern:
1. Check Redis cache
2. On cache miss, query MongoDB
3. Set cache for subsequent requests
4. Return JSON response

---

## Redis Caching Strategy

| Data           | Cache Key                          | TTL          |
| -------------- | ---------------------------------- | ------------ |
| All leagues    | `leagues:all`                      | 24 hours     |
| League teams   | `teams:league:{apiLeagueId}`       | 24 hours     |
| League fixtures| `fixtures:league:{apiLeagueId}`    | 10 minutes   |
| Today fixtures | `fixtures:today`                   | 10 minutes   |
| Fixture odds   | `odds:fixture:{apiFixtureId}`      | 15 seconds   |
| Live fixtures  | `live:fixtures`                    | 10 seconds   |

---

## Cron Job Schedules

| Job              | Schedule            | Description                                    |
| ---------------- | ------------------- | ---------------------------------------------- |
| syncLeagues      | `0 3 * * *`         | Fetch and upsert target leagues daily at 3 AM  |
| syncTeams        | `0 4 * * *`         | Fetch teams for each league daily at 4 AM      |
| syncFixtures     | `*/10 * * * *`      | Fetch fixtures for next 7 days every 10 min    |
| syncOdds         | `*/15 * * * * *`    | Fetch odds for upcoming fixtures every 15 sec  |
| syncLiveFixtures | `*/10 * * * * *`    | Update live scores every 10 sec                |

---

## Live Update Logic

When `syncLiveFixtures` detects a score change:

1. Updates the fixture score in MongoDB
2. Invalidates the Redis cache for that fixture's odds
3. Immediately re-fetches odds from API-Football
4. Upserts refreshed odds into the database
5. Updates the `live:fixtures` cache

---

## Odds Parsing

The `oddsParser.js` utility extracts these markets from the API-Football response:

| API Bet ID | Market Name         |
| ---------- | ------------------- |
| 1          | Match Winner        |
| 5          | Over/Under          |
| 8          | Both Teams To Score |
| 12         | Double Chance       |

---

## API-Football Integration

- **Base URL:** `https://v3.football.api-sports.io`
- **Auth Header:** `x-apisports-key: {API_FOOTBALL_KEY}`
- **Rate limits:** Depends on your subscription plan. The cron schedules are designed to stay within typical limits.

### Endpoints Used

| Endpoint      | Usage                    |
| ------------- | ------------------------ |
| `/leagues`    | Fetch all leagues        |
| `/teams`      | Fetch teams by league    |
| `/fixtures`   | Fetch fixtures by league/date, or live fixtures |
| `/odds`       | Fetch odds by fixture    |

---

## Future Provider Integration

The schema includes a `provider` field on League, Fixture, and Odd models (default: `"api-football"`). This allows adding alternative data sources such as:

- **Spribe** -- Casino/crash games (Aviator, etc.)
- Other sports data APIs

To add a new provider:
1. Create a new service file (e.g., `services/spribeService.js`)
2. Create corresponding sync jobs
3. Set the `provider` field to identify the source
4. Odds from multiple providers can coexist for the same fixture

---

## Betting Engine Preparation

Fixtures and odds are stored persistently in MongoDB so that the future betting engine (Bet, BetSlip, Ticket, Wallet) can:

- Reference historical odds at the time a bet was placed
- Validate bet selections against stored markets
- Settle bets using stored fixture results

---

## File Structure

```
backend/
├── config/
│   └── db.js                      # Prisma client singleton
├── controllers/
│   ├── auth.controller.js         # (existing)
│   ├── league.controller.js       # GET /api/leagues
│   ├── fixture.controller.js      # GET /api/fixtures/today, /live
│   └── odds.controller.js         # GET /api/odds/:fixtureId
├── jobs/
│   ├── index.js                   # Cron job registration
│   ├── syncLeagues.js
│   ├── syncTeams.js
│   ├── syncFixtures.js
│   ├── syncOdds.js
│   └── syncLiveFixtures.js
├── middleware/
│   └── auth.middleware.js         # (existing)
├── prisma/
│   └── schema.prisma              # All models
├── routes/
│   ├── auth.route.js              # (existing)
│   ├── league.route.js
│   ├── fixture.route.js
│   └── odds.route.js
├── services/
│   ├── apiFootballService.js      # API-Football HTTP client
│   └── cacheService.js            # Redis cache layer
├── utils/
│   └── oddsParser.js              # Odds response parser
├── .env
├── index.js                       # Express entry point
└── package.json
```

---

## Quick Start

```bash
# Install dependencies
cd backend && npm install

# Set environment variables in .env
# API_FOOTBALL_KEY=your_key
# REDIS_URL=redis://localhost:6379

# Generate Prisma client
npx prisma generate

# Push schema to MongoDB
npx prisma db push

# Start the server (cron jobs start automatically)
npm run dev
```
