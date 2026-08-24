# Cashback two-profile rules (v3)

**Status:** Implemented  
**Last reviewed:** 2026-08-23

---

## Product spec

Customers are eligible for cashback on a **LOST** ticket under one of two tracks.

### 1 loss

1. 5 or more bets on the ticket
2. Every bet greater than 1.01
3. No postponed / canceled / abandoned / suspended legs
4. Stake at least 10 Birr (online) or 20 Birr (cashier-printed)
5. Valid for 48 hours from placement
6. Live bets are not eligible (online only)

`result = sold total odds ÷ sum of lost-leg odds` (one lost leg → that leg's odds).

| result | Payout |
|--------|--------|
| 19–39 | 1 × stake |
| 40–59 | 2 × stake |
| 60–89 | 3 × stake |
| 90–250 | 5 × stake |
| 251–499 | 10 × stake |
| 500–999 | 20 × stake |
| 1000–1999 | 30 × stake |
| 2000–2999 | 50 × stake |
| ≥ 3000 | 100 × stake |

### 2 losses

1. 10 or more bets
2. Every bet greater than 1.40
3. No postponed / canceled / abandoned / suspended legs
4. Stake at least 20 Birr (both channels)
5. Valid for 48 hours from placement
6. Live bets are not eligible (online only)

`result = sold total odds ÷ (lostOddsA + lostOddsB)`.

| result | Payout |
|--------|--------|
| 20–45 | 1 × stake |
| 46–59 | 2 × stake |
| 61–89 | 3 × stake |
| 90–450 | 6 × stake |
| 451–999 | 12 × stake |
| 1000–1799 | 21 × stake |
| ≥ 1800 | 50 × stake |

---

## Interpretation decisions

- **"Minimum deposit"** is the **ticket stake**, not the player's wallet deposit history.
- **Two-loss ratio** uses the **sum** of the lost legs' placement odds, not the product and not the largest only.
- **0 lost legs** → `no_lost_leg`. **3+ lost legs** → `too_many_lost_legs` (the spec defines only 1 and 2).
- Per-leg odds floor applies to **every** leg, strictly greater than the threshold, using placement-locked odds.
- Live exclusion applies to **online tickets only**. A cashier-printed slip with a live leg can still pay.
- A live ticket is any selection with `live_at_placement === true`, or `ticket.channel === "LIVE"`.
- The 2-loss table has no band for `60`. `pickCashbackTier` rounds down to the band fully reached (e.g. 60.4 pays the 46–59 multiplier).
- `minLegs` is inclusive (`>=`). This is deliberately different from the v2 `minSelections` field, which meant strictly greater than.
- `maxHours` is measured from `ticket.created_at` to settlement (online) or claim scan (cashier).

---

## Engine versioning

`evaluateCashback` in [backend/lib/bonusEngine.js](../backend/lib/bonusEngine.js):

1. `rules.profiles` present → v3 (this document)
2. else `rules.tiers` present → v2 single-track (`total odds / largest lost-leg odds`)
3. else legacy flat `percentOfStake`

---

## Activation on existing databases

`ensureBonusPresets` upserts with `update: {}`, so live databases keep their current CASHBACK `rules` and would silently stay on v2.

To switch an existing database to v3 **without turning cashback on or off**:

```bash
node backend/scripts/setCashbackProfiles.js
```

Or open **Settings → Cashback**, confirm the two profiles, and save. Then toggle **Active** when ready.

Fresh seeds already store the v3 shape with `status: false`.
