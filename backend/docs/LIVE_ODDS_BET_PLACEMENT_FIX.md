# Live Odds Bet Placement Fix

This document explains the bug where live bets were booked using **prematch odds** instead of the **live odds shown in the UI**, and how it was fixed. Use this as a porting guide when applying the same fix to another codebase.

---

## Symptom

- User selects a live market (e.g. Home win at **1.909**).
- Bet placement succeeds with no error.
- Bet history / ticket shows the **prematch odd** (e.g. **1.33**), not the live odd.
- `totalOdds` and `potentialWin` on the ticket are also calculated from the wrong (lower) odd.

Example request:

```json
{
  "selections": [{
    "apiFixtureId": 1543870,
    "marketLabel": "1X2",
    "label": "1",
    "odds": 1.909,
    "fromLive": true
  }],
  "stake": 20
}
```

Example wrong response:

```json
{
  "totalOdds": 1.33,
  "potentialWin": 26.6
}
```

---

## Root Cause

There were **two separate data pipelines** for live odds:

| Layer | Source | Used for |
|-------|--------|----------|
| **UI display** | `GET /api/football/odds/live` → direct API-Sports `/odds/live` | What the user sees |
| **Bet booking** | `resolveLiveOdds()` → Redis → DB fallback | What gets saved on the ticket |

### Why booking used the wrong odd

1. **Redis was rarely populated during live play**
   - `syncLiveFixtures.js` only wrote live odds to Redis on score change, kickoff (`NS → LIVE`), or missing markets.
   - During normal in-play movement (odds changing, score unchanged), Redis was empty or expired (TTL ~20s).

2. **Display endpoint did not write to Redis**
   - `/odds/live` fetched fresh odds from API-Sports but never stored them for validation.

3. **Fallback to prematch DB**
   - When Redis had no match, `resolveLiveOdds()` fell back to `FixtureOddLine` in MongoDB (prematch odds from `syncOdds.js`).

4. **Live bets skip odds drift checks**
   - In `validateSelections.js`, when `live=true`, drift comparison is disabled. So client odd `1.909` vs server odd `1.33` never triggered `odds_changed` — the bet silently booked at the server (wrong) odd.

5. **Market name mismatch (critical detail)**
   - API-Sports live feed uses market name **`Fulltime Result`**.
   - Lookup candidates only included **`Full Time Result`** (with a space).
   - Redis stored keys like `Fulltime Result|Home`, but lookup searched for `Full Time Result|Home` → **miss** → DB fallback even when Redis had correct live data.

---

## Architecture (Before vs After)

### Before

```
UI (/odds/live) ──► API-Sports          (display only)
Bet validation    ──► Redis (empty/stale) ──► Prematch DB (wrong odd)
```

### After

```
UI (/odds/live) ──► API-Sports ──► Redis   (keeps cache warm)
Bet validation    ──► Redis (hit)         (correct live odd)
                 └──► API-Sports single-fixture fetch (Redis miss only)
                 └──► Prematch DB           (last resort only)
```

---

## Fix Summary (5 parts)

| # | Change | Purpose |
|---|--------|---------|
| A | Extract shared Redis writer (`liveOddsCache.js`) | Single place to write live odds snapshots |
| B | Piggyback Redis write on `/odds/live` fetch | Keep Redis in sync with what the UI shows |
| C | Add single-fixture live odds API method | Fallback fetch when Redis is empty at placement |
| D | Improve `resolveLiveOdds()` with API fallback | Fetch + cache on Redis miss before DB fallback |
| E | Add `"Fulltime Result"` to market name aliases | Fix Redis/API field key mismatch |
| F | Increase Redis TTL default 20s → 60s | Reduce expiry between polls |

---

## Files Changed

### 1. NEW: `backend/services/liveOddsCache.js`

**Why:** `writeLiveOddsSnapshot` lived only in `syncLiveFixtures.js`. The display endpoint and bet validator both needed the same writer.

**What was added:**

- `LIVE_ODDS_SNAPSHOT_TTL_SECONDS` — default **60** (was 20).
- `writeLiveOddsSnapshot(apiFixtureId, parsed)` — writes hash keys:
  - `live-odds:{fixtureId}` → field `{marketName}|{selectionLabel}` = odd
  - `live-market-state:{fixtureId}`
  - `live-market-version:{fixtureId}`
  - `live-market-updated-at:{fixtureId}`
- `writeLiveOddsFromApiResponse(rawLiveOdds)` — converts raw API-Sports `/odds/live` array into the parsed format and calls `writeLiveOddsSnapshot` per fixture.

**Porting note:** Copy this file wholesale. Update import paths to match your project structure.

---

### 2. EDIT: `backend/services/odds-engine/resolveOdds.js`

**Why:** Live API uses `"Fulltime Result"` but lookup only knew `"Full Time Result"`.

**Change:**

```javascript
const MATCH_WINNER_MARKET_NAMES = [
  "Match Winner",
  "1X2",
  "Full Time Result",
  "Fulltime Result",   // ← ADD THIS
  "Match Result",
];
```

**Porting note:** If your upstream uses other winner-market names, add them here too. Any name returned by `/odds/live` that isn't in this list will cause Redis lookup misses.

---

### 3. EDIT: `backend/services/odds-engine/resolveLiveOdds.js`

**Why:** This is the core resolver used when `fromLive: true` on bet placement. Previously: Redis miss → immediate prematch DB fallback.

**Changes:**

1. **Imports:** `api` from `apiSportsService.js`, `writeLiveOddsSnapshot` from `liveOddsCache.js`.

2. **New flow in `resolveLiveOdds()`:**
   - Step 1: Redis lookup per selection (`lookupRedisOdds`).
   - Step 2: Collect fixtures with Redis miss.
   - Step 3: For each missed fixture, call `api("football").getSingleFixtureLiveOdds(fixtureId)`, parse response, write to Redis, store parsed snapshot.
   - Step 4: Extract odd from API snapshot using same field candidates as Redis lookup.
   - Step 5: Only then fall back to `resolvePrematchOdds()` (DB) for anything still unresolved.

3. **New helpers:**
   - `lookupRedisOdds()` — Redis hash lookup with field candidates.
   - `parseApiResponseToSnapshot()` — normalizes single-fixture API response.
   - `extractOddFromSnapshot()` — matches `{market}|{label}` fields against candidates.

4. **Result metadata:** Each resolved row includes `source`:
   - `REDIS_LIVE` — found in Redis
   - `API_LIVE_FETCH` — fetched on placement fallback
   - `DB_FALLBACK` — prematch DB (should be rare after fix)

**Porting note:** The ticket controller already uses `row.serverOdds` from `validated.resolved` — no change needed there if your flow matches:

```javascript
odds: Number(row?.serverOdds ?? item.odds)
```

---

### 4. EDIT: `backend/services/apiSportsService.js`

**Why:** Placement fallback needs a per-fixture live odds call without fetching all live fixtures.

**Change:** Add method on the `api(sport)` client:

```javascript
getSingleFixtureLiveOdds: (fixtureId) =>
  request(sport, "/odds/live", { fixture: fixtureId }, 0, { skipCache: true }),
```

**Porting note:** Must use `skipCache: true` — live odds must never be served from stale upstream cache.

---

### 5. EDIT: `backend/routes/footballPublic.js`

**Why:** Every time the frontend polls live odds for display, Redis should be refreshed with the same data — zero extra API calls.

**Changes:**

1. Import `writeLiveOddsFromApiResponse` from `liveOddsCache.js`.

2. In `getRawLiveOddsCoalesced()`, after fetching from API-Sports:

```javascript
liveOddsSnapshot = { at: Date.now(), raw: raw ?? [], transformed: null };

if (raw?.length) {
  writeLiveOddsFromApiResponse(raw).catch((err) => {
    console.error("[getRawLiveOddsCoalesced] Redis write failed:", err);
  });
}
```

**Porting note:** Fire-and-forget (don't `await`) so the HTTP response to the frontend is not delayed by Redis writes.

---

### 6. EDIT: `backend/jobs/syncLiveFixtures.js`

**Why:** Avoid duplicating `writeLiveOddsSnapshot` — import from shared module.

**Changes:**

- Remove local `writeLiveOddsSnapshot` function and local `LIVE_ODDS_SNAPSHOT_TTL_SECONDS` constant.
- Import from `liveOddsCache.js`:

```javascript
import {
  writeLiveOddsSnapshot,
  LIVE_ODDS_SNAPSHOT_TTL_SECONDS,
} from "../services/liveOddsCache.js";
```

**Porting note:** Behavior unchanged for score-change refreshes; this is a refactor only.

---

## Files NOT Changed (but relevant)

| File | Role |
|------|------|
| `backend/controllers/ticketsController.js` | Already locks ticket at `row.serverOdds` from validation — fix is entirely in the resolver |
| `backend/services/odds-engine/validateSelections.js` | Already calls `resolveLiveOdds` when `live=true`; skips drift for live bets |
| `frontend/src/services/api.js` | Already sends `fromLive: true` and client `odds` — no frontend change required |

---

## How to Verify the Fix

### 1. Validate endpoint (no wallet needed)

```http
POST /api/bets/validate
Content-Type: application/json

{
  "selections": [{
    "apiFixtureId": <live_fixture_id>,
    "marketLabel": "1X2",
    "label": "1",
    "odds": <display_odd_from_ui>,
    "fromLive": true
  }],
  "stake": 20
}
```

**Expected:** `totalOdds` equals the live display odd (within normal live movement).

### 2. Place bet

```http
POST /api/bets/place
```

**Expected:** Response `totalOdds` matches live odd, not prematch odd. Bet history shows the same odd.

### 3. Redis check (optional)

After hitting `/api/football/odds/live`:

```bash
redis-cli HGETALL "live-odds:<apiFixtureId>"
```

**Expected:** Fields like `Fulltime Result|Home`, `Match Winner|Home`, etc.

---

## Environment / Infrastructure Requirements

For the fix to work in production:

1. **Redis must be running** and reachable by the backend (`REDIS_URL`).
2. **Backend must run the updated code** — rebuild/restart Docker container after copying files (volume mounts may not sync on all setups).
3. **Optional env:** `LIVE_ODDS_SNAPSHOT_TTL_SECONDS=60` (or 90–120 under heavy load).

---

## Porting Checklist (Another Codebase)

- [ ] Create `services/liveOddsCache.js` (or equivalent path)
- [ ] Add `"Fulltime Result"` to winner market name aliases
- [ ] Add `getSingleFixtureLiveOdds(fixtureId)` to your API-Sports client
- [ ] Update live odds display fetch to call `writeLiveOddsFromApiResponse(raw)`
- [ ] Replace `resolveLiveOdds()` with Redis → API fallback → DB fallback flow
- [ ] Point `syncLiveFixtures` (or equivalent job) at shared `writeLiveOddsSnapshot`
- [ ] Rebuild/restart backend
- [ ] Confirm Redis is up
- [ ] Test with `/api/bets/validate` comparing display odd vs `totalOdds`

---

## Known Edge Cases

| Case | Behavior |
|------|----------|
| Fixture not in DB | `unknown_fixture` — unrelated to this fix |
| Redis down | API fallback on placement; may add ~200–500ms latency |
| API-Sports unreachable | Falls back to prematch DB (old behavior) |
| Market name not in alias list | Redis miss → possible DB fallback; add alias |
| Live bet drift disabled | Client odd is ignored; server odd always wins — ensure server resolution is correct |

---

## Summary

The bug was **not** in bet history display or the frontend. The UI showed live odds from API-Sports, but bet validation could not read those same odds from Redis (cache empty, wrong market name) and silently fell back to stale prematch database odds. The fix unifies the display and validation pipelines by writing live odds to Redis on every display fetch, fetching single-fixture live odds on Redis miss, and aligning market name aliases with API-Sports live feed naming.
