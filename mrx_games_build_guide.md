# MRX Instant Games — Build Guide (Sokasport)

How to rebuild the MRX Keno / Aviator / Bingo integration on a **new** bet platform (or understand every file that makes it work in this repo).

Players keep their account and wallet on the **bet platform**. Games open already logged in via a short-lived encrypted SSO token. Bets and wins hit the bet wallet through a private server-to-server API.

---

## Architecture

```
Player → Casino page → POST /api/player/generate-sso-token (JWT)
                    → open https://games.sokasports.com/game/{keno|aviator|bingo}?sso_token=...

MRX game backend → POST /api/internal/wallet/adjust-balance (x-api-key)
                 → debit GAME_FEE / credit GAME_WINNING → { newBalance }
```

**SSO payload** (AES-256-CBC, format `iv_hex:ciphertext_hex`):

```json
{ "phone": "2519…", "name": "…", "balance": 1060, "timestamp": 1234567890 }
```

**Ledger mapping** (no new Prisma enum values):

| MRX type       | Wallet op                                      | Transaction type |
|----------------|------------------------------------------------|------------------|
| `GAME_FEE`     | `debitWallet` (stake: non-withdrawable first)  | `BET`            |
| `GAME_WINNING` | `creditWallet({ withdrawable: true })`         | `PAYOUT`         |

References: `mrx:fee:{id}` / `mrx:win:{id}` (idempotent via unique `Transaction.reference`).

---

## Prerequisites (existing platform pieces)

These already exist in Sokasport; a new system needs equivalents:

| Capability | This repo |
|---|---|
| Player JWT auth | [`backend/middleware/auth.js`](backend/middleware/auth.js) — `authenticateToken`, JWT `sub` + `role` |
| Player user + phone | [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma) — `User.phone`, `User.fullname` |
| Phone normalize | [`backend/lib/phone.js`](backend/lib/phone.js) — `normalizeEthiopiaPhone` |
| PLAYER wallet | `Wallet` + `wallet_type: PLAYER` |
| Debit / credit helpers | [`backend/lib/walletBalance.js`](backend/lib/walletBalance.js) — `debitWallet`, `creditWallet` |
| Money rounding | [`backend/lib/moneyDecimal.js`](backend/lib/moneyDecimal.js) |
| Casino route / nav | [`frontend/src/App.jsx`](frontend/src/App.jsx) `/casino`, nav → `/casino` in [`frontend/src/data/homepageData.js`](frontend/src/data/homepageData.js) |

---

## Environment

### Backend — add to [`.env`](backend/.env) / [`.env.example`](backend/.env.example) / [`.env.production.example`](backend/.env.production.example)

```env
# AES-256 key material (64 hex chars). Must match MRX exactly.
MRX_ENCRYPTION_KEY=a1b6783d4e5f6789012345901234567890123456789901234567890123456782

# Shared secret for x-api-key on the wallet bridge. Must match MRX.
INTERNAL_BRIDGE_KEY=mrx-internal-bridge-key-change-in-production
```

### Frontend — [`.env.example`](frontend/.env.example) / production build env

```env
VITE_GAME_BASE_URL=https://games.sokasports.com
```

Launch URLs:

```
{VITE_GAME_BASE_URL}/game/keno?sso_token=...
{VITE_GAME_BASE_URL}/game/aviator?sso_token=...
{VITE_GAME_BASE_URL}/game/bingo?sso_token=...
```

---

## File map (create / wire these)

### 1. SSO encryption

| File | Role |
|---|---|
| [`backend/lib/mrxSso.js`](backend/lib/mrxSso.js) | `encryptMrxSsoToken` / `decryptMrxSsoToken`. Key = `Buffer.from(MRX_ENCRYPTION_KEY.slice(0, 64), "hex")`. AES-256-CBC. Payload: `phone`, `name`, `balance`, `timestamp`. |
| [`backend/controllers/playerSsoController.js`](backend/controllers/playerSsoController.js) | `POST` handler: PLAYER only, load user + PLAYER wallet, encrypt, return `{ success, ssoToken }`. |
| [`backend/routes/player.js`](backend/routes/player.js) | Register: `router.post("/generate-sso-token", generateSsoToken)`. Mounted under JWT at `/api/player` in [`backend/index.js`](backend/index.js). |

**Endpoint:** `POST /api/player/generate-sso-token`  
**Auth:** `Authorization: Bearer <player JWT>`

### 2. Internal wallet bridge

| File | Role |
|---|---|
| [`backend/middleware/internalBridgeAuth.js`](backend/middleware/internalBridgeAuth.js) | `verifyInternalBridgeKey` — require `x-api-key === INTERNAL_BRIDGE_KEY`. |
| [`backend/lib/mrxWalletRefs.js`](backend/lib/mrxWalletRefs.js) | `feeRef` / `winRef` / `parseAdjustBalanceBody` (pure validation, no DB). |
| [`backend/services/mrxWallet.js`](backend/services/mrxWallet.js) | `debitGameFee` / `creditGameWinning` — Prisma `$transaction`, phone normalize, idempotent refs, uses `walletBalance.js`. |
| [`backend/controllers/internalWalletController.js`](backend/controllers/internalWalletController.js) | Map service statuses → HTTP (`400` insufficient, `404` user/wallet, `200` + `newBalance`). |
| [`backend/routes/internalWallet.js`](backend/routes/internalWallet.js) | `POST /adjust-balance` + API-key middleware. |
| [`backend/index.js`](backend/index.js) | Mount **without JWT**: `app.use("/api/internal/wallet", internalWalletRoutes)`. |

**Endpoint:** `POST /api/internal/wallet/adjust-balance`  
**Auth:** header `x-api-key` only (no JWT)

```json
{
  "phone": "0911556677",
  "type": "GAME_FEE",
  "amount": 50,
  "reference": "unique-tx-id"
}
```

Success: `{ "success": true, "newBalance": 950 }`

### 3. Phone helper (lookup)

| File | Role |
|---|---|
| [`backend/lib/phone.js`](backend/lib/phone.js) | Bridge lookups use `normalizeEthiopiaPhone` so `09…` and `251…` match. (SSO sends phone **as stored**.) |

### 4. Frontend launch UI

| File | Role |
|---|---|
| [`frontend/src/pages/Casino.jsx`](frontend/src/pages/Casino.jsx) | Instant Games cards (Keno / Aviator / Bingo). On Play: login check → `generateMrxSsoToken()` → `window.open(base + path + ?sso_token=)`. |
| [`frontend/src/services/api.js`](frontend/src/services/api.js) | `generateMrxSsoToken()` → `POST /api/player/generate-sso-token`. |
| [`frontend/src/i18n/coreTranslations.js`](frontend/src/i18n/coreTranslations.js) | Labels: `casino.kenoName`, `aviatorName`, `bingoName`, `instantEyebrow`, etc. |
| [`frontend/src/assets/games/keno.png`](frontend/src/assets/games/keno.png) | Thumbnails used by Casino Instant Games. |
| [`frontend/src/assets/games/aviator.png`](frontend/src/assets/games/aviator.png) | |
| [`frontend/src/assets/games/bingo.png`](frontend/src/assets/games/bingo.png) | |

Nav already points **Games** → `/casino` ([`homepageData.js`](frontend/src/data/homepageData.js), [`MobileBottomBar.jsx`](frontend/src/components/layout/MobileBottomBar.jsx)).

### 5. Tests

| File | Role |
|---|---|
| [`backend/tests/mrxSso.test.js`](backend/tests/mrxSso.test.js) | Encrypt/decrypt, key derivation, `balance` round-trip. |
| [`backend/tests/mrxWallet.test.js`](backend/tests/mrxWallet.test.js) | `feeRef` / `winRef` / `parseAdjustBalanceBody`. |
| [`backend/tests/internalWalletAuth.test.js`](backend/tests/internalWalletAuth.test.js) | API-key middleware accept/reject. |
| [`backend/tests/phone.test.js`](backend/tests/phone.test.js) | Phone normalize (+ `toLocalEthiopiaPhone` if present). |

```bash
node --test backend/tests/mrxSso.test.js \
  backend/tests/mrxWallet.test.js \
  backend/tests/internalWalletAuth.test.js \
  backend/tests/phone.test.js
```

---

## Build order (new system)

1. **Env** — set `MRX_ENCRYPTION_KEY`, `INTERNAL_BRIDGE_KEY`, `VITE_GAME_BASE_URL` (share secrets with MRX).
2. **SSO lib + controller + player route** — mint token with `phone`, `name`, `balance`, `timestamp`.
3. **Wallet bridge** — middleware → refs/validation → service (debit/credit) → controller → mount **without** JWT.
4. **Frontend** — Instant Games UI + `generateMrxSsoToken` + env base URL.
5. **Tests** — SSO encrypt, body validation, API key.
6. **Verify** (see below) then share endpoints + keys with the games team.

---

## API quick reference

### Generate SSO

```http
POST /api/player/generate-sso-token
Authorization: Bearer <player JWT>
```

```json
{ "success": true, "ssoToken": "<iv_hex>:<ciphertext_hex>" }
```

### Adjust balance

```http
POST /api/internal/wallet/adjust-balance
x-api-key: <INTERNAL_BRIDGE_KEY>
Content-Type: application/json
```

| Field | Notes |
|---|---|
| `phone` | `09…` or `251…` |
| `type` | `GAME_FEE` or `GAME_WINNING` |
| `amount` | Positive number |
| `reference` | Unique idempotency key (recommended) |

| Status | Meaning |
|---|---|
| `200` | `{ success: true, newBalance }` (also for duplicate `reference`) |
| `403` | Bad / missing API key |
| `400` | Insufficient balance / invalid body |
| `404` | User or wallet not found |

---

## Verification checklist

**SSO**

- [ ] Log in as PLAYER → `/casino` → Instant Game → new tab has `?sso_token=`
- [ ] Decrypt (or ask MRX) shows `phone`, `name`, `balance`, `timestamp`
- [ ] Logged out → Play → redirect `/login`
- [ ] Staff JWT → `403`

**Balance bridge**

- [ ] `GAME_FEE` decreases balance; ledger `BET` with `mrx:fee:…`
- [ ] `GAME_WINNING` increases balance + withdrawable; ledger `PAYOUT` with `mrx:win:…`
- [ ] Missing/wrong key → `403`
- [ ] Overdraft → `400 Insufficient balance`
- [ ] Same `reference` twice → same `newBalance`, no double debit

**Manual curl (production example)**

```bash
# Login
TOKEN=$(curl -sS -X POST https://api.YOURDOMAIN.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"phone":"09…","password":"…"}' | jq -r .accessToken)

# SSO
curl -sS -X POST https://api.YOURDOMAIN.com/api/player/generate-sso-token \
  -H "Authorization: Bearer $TOKEN"

# Bridge debit
curl -sS -X POST https://api.YOURDOMAIN.com/api/internal/wallet/adjust-balance \
  -H 'Content-Type: application/json' \
  -H "x-api-key: $INTERNAL_BRIDGE_KEY" \
  -d '{"phone":"09…","type":"GAME_FEE","amount":10,"reference":"test-1"}'
```

---

## What not to change

- InOut casino seamless wallet ([`backend/services/inoutWallet.js`](backend/services/inoutWallet.js)) — separate integration.
- Prisma `TransactionType` enum — reuse `BET` / `PAYOUT`.
- Sportsbook ticket / odds / settlement code.

---

## Related docs

- Vendor brief (original): [`bet_integration_guide.md`](bet_integration_guide.md) — note: older sample used separate Aviator/Bingo hosts and SSO without `balance`; this repo’s implementation above is the source of truth.

---

*Last updated: July 2026*
