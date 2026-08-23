# Check coupon — per-leg result status + paper-ticket receipt UI

**Status:** Implemented (2026-06-02)  
**Last reviewed:** 2026-06-02

---

## Executive summary

The public **Check coupon / Check ticket** feature lets anyone look up a coupon
number and see its games. Two improvements were shipped:

1. **Per-leg result status** — a marker in front of each match showing one of
   four states: **WON** (green check), **LOST** (red X),
   **POSTPONED / not finished** (yellow dash), **NOT played yet** (neutral
   circle). This combines the settlement `result` with the match `status` so a
   still-pending leg is split into "in play / postponed" vs "hasn't kicked off".
2. **Paper-ticket receipt UI** — the result card was restyled to look like the
   printed thermal receipt: white paper, monospace, dashed dividers, scalloped
   "torn" edges, brand wordmark + coupon number, per-leg rows.

The same receipt is now used in **three** places, via one shared component:
the Check-ticket page and the **Check Coupon** preview inside the **desktop**
and **mobile** bet slips.

> Decisions taken with the product owner: the public card shows **Stake,
> Max Win, Total Odd, and Net Pay** (same rows as the printed slip), and the
> coupon id is shown as **text, not a scannable barcode** (avoids a new
> frontend dependency).

---

## Files changed

| Area | File | Change |
|------|------|--------|
| Backend | [backend/controllers/ticketsController.js](../backend/controllers/ticketsController.js) | Added `result` + `status` to each leg in `mapPublicCouponPayload` (both branches) |
| Frontend util | [frontend/src/utils/legResultStatus.js](../frontend/src/utils/legResultStatus.js) | **New** — `classifyLegStatus()` pure classifier |
| Frontend test | [frontend/src/utils/legResultStatus.test.js](../frontend/src/utils/legResultStatus.test.js) | **New** — vitest coverage (8 tests) |
| Frontend component | [frontend/src/components/common/CouponReceipt.jsx](../frontend/src/components/common/CouponReceipt.jsx) | **New** — shared paper-receipt + result icons |
| Frontend CSS | [frontend/src/index.css](../frontend/src/index.css) | Added `.coupon-receipt` scalloped-edge mask |
| Frontend page | [frontend/src/pages/CheckTicket.jsx](../frontend/src/pages/CheckTicket.jsx) | Renders `<CouponReceipt>` |
| Frontend slip (desktop) | [frontend/src/components/sections/BetSlipPanel.jsx](../frontend/src/components/sections/BetSlipPanel.jsx) | Check-coupon modal renders `<CouponReceipt>` (was a table) |
| Frontend slip (mobile) | [frontend/src/components/sections/MobileBetSlip.jsx](../frontend/src/components/sections/MobileBetSlip.jsx) | Same as above |

**Untouched on purpose:** the *Load Coupon* flow (copies selections into a slip,
not a results view), and the **My Bets** history page (`BetHistory.jsx`) which
has its own per-leg pills.

---

## 1. Data contract — backend

The public endpoint is `GET /api/cms/ticket-by-coupon?couponNumber=`, served by
`getPublicCouponTicket()` → `mapPublicCouponPayload(ticket)` in
[backend/controllers/ticketsController.js](../backend/controllers/ticketsController.js).

It originally returned, per selection: `matchName`, `marketLabel`, `label`,
`odds`, `apiFixtureId`, `marketCode`, `marketParams`, `kickoffAt`. It did **not**
return the settlement result or the match status, so the UI could not show
WON/LOST. Two fields were added:

```js
// rows branch (ticket has selection rows) — matchPayload is already computed
// via buildMatchPayloadForTicketSelection(selection, snap)
return {
  matchName, marketLabel, label, odds, apiFixtureId, marketCode, marketParams,
  kickoffAt,
  result: selection.result ?? "PENDING",   // ADDED
  status: matchPayload?.status ?? null,     // ADDED
};

// snapshot-only branch (legacy tickets with no selection rows) — no match in scope
return {
  matchName, marketLabel, label, odds, apiFixtureId, marketCode, marketParams,
  kickoffAt,
  result: "PENDING",  // ADDED
  status: null,        // ADDED
};
```

No Prisma query change was needed — `selection.result`, `match`, and `fixture`
are already loaded by the endpoint's include.

### Field meanings

- **`result`** — settlement enum `SelectionResult`: `PENDING | WON | LOST | VOID`.
- **`status`** — match status. For admin-managed matches it is the `MatchStatus`
  enum (`NOT_STARTED | LIVE | FINISHED | SUSPENDED`); for API-Sports fixtures it
  is the raw status string (`NS | LIVE | HT | FT | AET | PEN | PST | CANC | ABD |
  AWD | WO | SUSP | …`).

> **Privacy note:** exposing `result`/`status` on a public endpoint is safe —
> they are match-outcome fields, not player/cashier identity. The authed mapper
> (`mapTicket`) already returned them; this just brings the public mapper in line.

---

## 2. Classification logic — `classifyLegStatus`

[frontend/src/utils/legResultStatus.js](../frontend/src/utils/legResultStatus.js)
is a pure function mapping a leg to one of four buckets. **Result takes
precedence; status only matters while the leg is still PENDING.**

```js
classifyLegStatus({ result, status, kickoffAt }, now = Date.now())
//   → "won" | "lost" | "postponed" | "notplayed"
```

Precedence:

1. `result === "WON"` → `won`
2. `result === "LOST"` → `lost`
3. `result === "VOID"` → `postponed`
4. `result` is `PENDING` / unknown → decide on `status`:
   - terminal (`FT/AET/PEN/AWD/WO/FINISHED…`, via `isTerminalMatchStatus`) → `postponed` *(finished but not yet graded — settlement runs on a job)*
   - in-progress / suspended (`LIVE/HT/1H/2H/ET/BT/P/INT/SUSP/SUSPENDED`) → `postponed`
   - not started (`NS/NOT_STARTED/TBD/""/null`) → `notplayed`, **unless** `kickoffAt` is already in the past (sync lag) → `postponed`
   - unknown / unmapped status → `notplayed` (safe default)

It reuses `isTerminalMatchStatus` from
[frontend/src/utils/selectionExpiry.js](../frontend/src/utils/selectionExpiry.js)
so the terminal-status set stays defined in one place. It normalizes status by
upper-casing and stripping spaces, and accepts **both** the admin enum
(`NOT_STARTED`) and the fixture code (`NS`).

### Why the four buckets

The "POSTPONED or not finished" bucket deliberately merges three real-world
cases that all mean *"don't read a win/loss here yet"*: VOID legs, in-play legs,
and postponed/cancelled legs. "NOT played" is strictly *kickoff is in the
future*. This matches how a bettor reads a paper slip.

### Tests

[frontend/src/utils/legResultStatus.test.js](../frontend/src/utils/legResultStatus.test.js)
covers all four buckets incl. VOID→postponed, finished-but-pending lag,
live/suspended, postponed/cancelled, NS+past-kickoff, null, and unknown status.
Run: `cd frontend && npx vitest run src/utils/legResultStatus.test.js`.

---

## 3. The receipt component — `CouponReceipt`

[frontend/src/components/common/CouponReceipt.jsx](../frontend/src/components/common/CouponReceipt.jsx)
is the single source of truth for the paper look. Props:

```jsx
<CouponReceipt ticket={payload} />
// payload = { couponNumber, selections: [{ matchName, marketLabel, label,
//             odds, kickoffAt, result, status }] }
```

Structure (top → bottom): brand **wordmark** → coupon number → dashed divider →
"Games on this coupon" → per-leg rows → dashed divider → footer note
("Stake and payout follow your receipt when the bet is paid or printed.").

Each leg renders the **result icon in front of the match name**, then
`N. Home vs Away`, the kickoff (`dd/mm hh:mm`), and `Market: Pick` … `odds`,
with a dashed hyphen rule between legs.

### Icon palette (tuned for white paper)

| Bucket | Icon (lucide via `AppIcon`) | Colour |
|--------|------------------------------|--------|
| `won` | `check` | `#15803d` green |
| `lost` | `x` | `#b91c1c` red |
| `postponed` | `minus` | `#ca8a04` gold/yellow |
| `notplayed` | `circle` | `#9ca3af` neutral grey |

> "NOT played = white" from the original spec became a **neutral grey circle**:
> on white paper a white marker is invisible. Grey reads as the same
> "neutral / not yet" state while staying visible. Green/red/gold also work on a
> dark background, so the same component renders fine inside the dark slip modals.

### Styling notes

- White paper: `bg-[#fcfcf9] text-[#0a0a0a] font-mono`, bold, `max-w-[330px]`.
- Brand name comes from `topHeaderData.brand` (no logo image — the app's logos
  are light-on-dark and would vanish on white paper).
- Dashed dividers are simple `border-t border-dashed` elements.

---

## 4. Scalloped "torn paper" edge — CSS

Added to [frontend/src/index.css](../frontend/src/index.css). A CSS mask punches
half-circles out of the top and bottom of the card so the dark page shows
through, mimicking a perforated thermal receipt:

```css
.coupon-receipt {
  -webkit-mask:
    radial-gradient(circle at 50% 0,   transparent 7px, #000 7.5px) repeat-x 0 0   / 15px 51%,
    radial-gradient(circle at 50% 100%, transparent 7px, #000 7.5px) repeat-x 0 100% / 15px 51%;
  mask:
    radial-gradient(circle at 50% 0,   transparent 7px, #000 7.5px) repeat-x 0 0   / 15px 51%,
    radial-gradient(circle at 50% 100%, transparent 7px, #000 7.5px) repeat-x 0 100% / 15px 51%;
}
```

Two layers, each 51% tall (anchored top and bottom, overlapping in the middle so
there is no gap). Keep the card's vertical padding ≥ 8px (we use `py-7`) so the
notches never clip content. Works in modern Chromium/Safari/Firefox.

---

## 5. Integration points

All three call sites already had a coupon payload from `fetchPublicCouponTicket`,
so wiring was just rendering the component:

- **Check-ticket page** ([CheckTicket.jsx](../frontend/src/pages/CheckTicket.jsx)) —
  `{preview ? <CouponReceipt ticket={preview} /> : null}`.
- **Desktop slip** ([BetSlipPanel.jsx](../frontend/src/components/sections/BetSlipPanel.jsx)) —
  the **Check Coupon…** input sets `couponCheckPreview`; its modal now renders
  `<CouponReceipt ticket={couponCheckPreview} />` instead of a Match/Market/Pick/Odds table.
- **Mobile slip** ([MobileBetSlip.jsx](../frontend/src/components/sections/MobileBetSlip.jsx)) —
  same change in the mobile drawer's check-coupon modal.

The white receipt is centered inside the existing dark modal panel (reads like a
printed ticket lying on the modal).

---

## Porting checklist (for another project)

- [ ] Public coupon endpoint returns per-leg **`result`** (settlement) **and**
      **`status`** (match) — add them if missing; no extra DB query if the
      relations are already included.
- [ ] Normalize the two status vocabularies you have (admin enum vs feed codes)
      in one place; reuse your existing "terminal status" set.
- [ ] Implement `classifyLegStatus(result, status, kickoffAt)` → 4 buckets, with
      **result-first** precedence and the not-started-but-kickoff-passed → not
      finished safeguard. Unit-test all buckets.
- [ ] Build one **shared** receipt component; render it everywhere coupons are
      shown (results page + every bet-slip "check coupon" entry point) so they
      never drift.
- [ ] Pick a neutral marker for "not played" that is visible on **both** the
      paper background and any dark modal background.
- [ ] Show Stake / Max Win / Total Odd / Net Pay on the public receipt, and
      decide whether the coupon id is a barcode (extra dependency) or plain text.
- [ ] Scalloped edge is optional flavour — a CSS `mask` of repeating radial
      gradients; ensure card padding exceeds the notch radius.

---

## Verification

- **Unit:** `cd frontend && npx vitest run src/utils/legResultStatus.test.js` (8 pass).
- **Build:** `cd frontend && npx vite build` compiles (incl. the CSS mask).
- **API:** `curl "http://localhost:3001/api/cms/ticket-by-coupon?couponNumber=<id>"`
  — confirm each `selections[]` entry has `result` and `status`.
- **Manual:** open `/check-ticket`, or a bet slip → **Check Coupon…**, and look
  up a multi-leg coupon mixing settled / live / unstarted matches to see all four
  markers. (Settled WON/LOST appear only after a fixture is graded; a leg whose
  match hasn't kicked off shows the grey circle; live/suspended/postponed/void
  shows the gold dash.)
