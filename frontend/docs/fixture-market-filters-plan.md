# Fixture dropdown market filters — implementation plan

## Context

Expanded fixture rows (`MatchesTable.jsx`) expose a horizontal filter bar (`DETAIL_FILTERS`) and gate visible market blocks with `getCategoriesForFilter`. That function today uses coarse regular expressions over `category.category` (the upstream `market.name`). Problems:

| Tab | Issue |
|-----|--------|
| **Main Market** | Regex keywords miss many core markets (`Home/Away`, `Draw No Bet`, etc.) while pulling unrelated “both teams to score” wording |
| **Total** → **Goals** | Any name with `over\|under\|total` drags in corners cards, handicaps, shots |
| **Combination** | `1x2` matches almost everything with “Match Winner”; `correct score` is not what “combination” means product-wise |
| **Half Time** | Requires substring `half time`; real names often use `First Half`, `2nd Half`, `(1st Half)`, etc. |
| **Corners / Handicaps** | Single-keyword tests are acceptable as *hints* but should not be the only source of truth |

The feed stores human-readable **`market.name`** strings (see `fixtureMapper.js` → `toDetailedOdds`). The fix is **explicit catalog → tab assignment** plus **normalization**, not more inline regex.

## Target UX (production tab order)

1. **All** — union of everything returned for the fixture (default for first paint). Subtitle-style copy: “Everything combined”.
2. **Main Market**
3. **Goals** *(rename from current “Total” to match operator language)*  
4. **Combination**  
5. **Half Time**  
6. **Corners**  
7. **Cards**  
8. **Yellow Cards**  
9. **Offsides**  
10. **Shots**  
11. **Shots on Target**  
12. **Minutes**  
13. **Handicaps**

**Deferred (future tabs)** — do not cram into football v1:

- Player markets  
- Team specials  
- Low-frequency stats: goalkeeper saves, tackles, fouls, assists  

Keep those off the primary strip until product defines data + layout.

### Initial collapse / lazy-load (recommended behavior)

- In **All**, show **5–10** “hero” accordion blocks (already-priced markets first — e.g. Match Winner, O/U Goals, BTTS).  
- **“Show all markets”** expands the rest for that fixture only (or paginate by N blocks).  
- Per-tab views can show all matches for that tab without the hero cap, or reuse the same pattern for very long lists.

## Data model

### Source of truth

- Add `frontend/src/data/footballMarketsByCategory.js` (this repo): ordered tab metadata + **per-tab lists of canonical market labels** supplied by trading/product.  
- Each **logical market** can map to **multiple tabs** (e.g. `Asian Handicap` appears under **Main Market** and **Handicaps**).

### Normalization (single implementation)

Before lookup, normalize both API names and catalog keys:

- Trim, Unicode NFKC, collapse internal whitespace  
- Lowercase for comparison only (preserve display `market.name` in UI)  
- Unify common punctuation: hyphen / en-dash, straight quotes  
- Optional: strip trailing period, normalize `1st` / `First` only via an **alias table** (not blind replacement)

### Resolution order (per `market.name`)

1. **Alias map** — API quirks (`“Match Winner”` vs `“Fulltime Result”`, etc.) → canonical key  
2. **Exact match** on normalized catalog strings  
3. **Pattern rules** (optional second phase) — only for stable families, e.g. `^Total Corners`  
4. If no match: **All** only; optional dev-only `console.debug` or telemetry flag for unknown names

### Overlap / precedence

When the same string is intentionally in two tabs, **no precedence needed** — both tabs show it. When two *different* strings describe the same market, fix it in **aliases**, not heuristics.

## Code changes (incremental)

### Phase 1 — Wire catalog (no visual redesign)

1. Export from `footballMarketsByCategory.js`:  
   - `MARKET_FILTER_TAB_ORDER`  
   - `getTabsForMarketName(name) -> Set<TabId>` or `string[]`  
   - `normalizeMarketName(name)`  
2. Replace `getCategoriesForFilter` in `MatchesTable.jsx` to:  
   - `All` → return full `categories`  
   - else → `categories.filter(c => getTabsForMarketName(c.category).has(activeTabId))`  
3. Rename UI label **Total → Goals** and extend `DETAIL_FILTERS` to the full tab order above (scroll/strip on small widths).  
4. Add **unit tests** for `getTabsForMarketName` with real names sampled from DB or staging API (export a JSON fixture of distinct `market.name` values).

### Phase 2 — Hero + lazy expansion

1. In the expanded panel, compute `heroMarkets` (fixed id list or “first N after sort order”).  
2. Render collapsed state with **Show more** to reveal the remainder in **All** only (or optionally in every tab if lists are extreme).

### Phase 3 — Backend alignment (optional but ideal)

If providers use stable **market IDs** in DB, consider returning `market_key` with odds payloads and keying the catalog off IDs; keep display names as labels only.

## Validation checklist

- [ ] Snapshot N fixtures from staging; diff **unknown** names (no tab except All) → grow alias table  
- [ ] Live vs prematch payloads use same naming — verify on `Live.jsx` expanded rows if reused  
- [ ] Bet slip ids remain stable (`matchName-marketLabel-selection` unaffected by tab UX)  

## Files touched (expected)

| File | Change |
|------|--------|
| `frontend/src/data/footballMarketsByCategory.js` | **New** — tab order + catalog + normalization + resolver |
| `frontend/src/components/sections/MatchesTable.jsx` | Replace regex filter; tab labels order |
| `frontend/src/data/__tests__/footballMarketsByCategory.test.js` *(or colocated)* | Resolver + alias coverage |

---

*Companion file: `footballMarketsByCategory.js` — market names grouped by tab per product taxonomy.*
