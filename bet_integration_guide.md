# Integration Guide: Connecting Your Bet Platform to Our Game Platform

> **Context:** We are building a separate games platform (Keno, Aviator, Bingo). Players register and hold their wallet on **your** Bet platform. When a player clicks a game from the Bet app, we need them to land on our game site already **logged in** — no second login, same account.
> This document tells you **exactly what to add** to your project. 


## How It Works

1. A player is logged into your Bet site and clicks "Play" on a game card.
2. **Your backend** generates a short-lived encrypted token containing the player's phone number and name.
3. **Your frontend** opens our game site in a new tab or iframe, passing that token in the URL (`?sso_token=...`).
4. **Our backend** receives the token, decrypts it, and logs the player in automatically.

The player never sees a second login screen.

---

## What You Need to Add

Two changes total:

| # | Where | What |
|---|-------|------|
| 1 | Your **backend API** | A new endpoint that generates the encrypted SSO token |
| 2 | Your **player-facing frontend** | A Games page that uses SSO to open our games |

---

## Change 1 — Backend: New SSO Endpoint

### Shared Secret Key

Both our platform and yours must use the **same** encryption key. Add this to your backend [.env]

MRX_ENCRYPTION_KEY=a1b6783d4e5f6789012345901234567890123456789901234567890123456782
INTERNAL_BRIDGE_KEY=mrx-internal-bridge-key-change-in-production



> [!IMPORTANT]
> This value must match exactly. Do not change it without telling us — we will need to update our side too.

### Endpoint to Create

```
POST /api/player/generate-sso-token
Authorization: Bearer <player JWT>

Success response:
{ "success": true, "ssoToken": "<iv_hex>:<ciphertext_hex>" }

Error response:
{ "success": false, "message": "..." }
```

### Implementation (Node.js / Express)

Create a new file — e.g. [routes/playerSso.js] — and paste this:

```js
import express from "express";
import crypto from "node:crypto";

const router = express.Router();

/**
 * POST /api/player/generate-sso-token
 *
 * Call this with the player's JWT in the Authorization header.
 * Returns an encrypted token that our game platform uses to log the player in.
 */
router.post(
  "/generate-sso-token",
  /* PUT YOUR EXISTING JWT AUTH MIDDLEWARE HERE — e.g. authenticateToken */,
  async (req, res) => {
    try {
      // ── 1. Get the player ID from the JWT ──────────────────────────────────
      // Adjust the field name to match what your JWT puts in req.user:
      const userId = req.user?.id ?? req.user?.sub ?? req.user?._id;
      if (!userId)
        return res.status(401).json({ success: false, message: "Unauthorized" });

      // ── 2. Load the player's phone + name from your database ───────────────
      // Replace this with whatever ORM/query style your project uses.
      // The player object must have: { phone, name }
      const player = await YourUserModel.findById(userId);  // adapt as needed
      if (!player)
        return res.status(404).json({ success: false, message: "Player not found" });

      // ── 3. Build the payload ───────────────────────────────────────────────
      const payload = JSON.stringify({
        phone:     player.phone,
        name:      player.name || player.phone,
        timestamp: Date.now(),   // we use this to reject tokens older than 5 min
      });

      // ── 4. Encrypt with AES-256-CBC ────────────────────────────────────────
      const key       = process.env.MRX_ENCRYPTION_KEY;
      const keyBuffer = Buffer.from(key.slice(0, 64), "hex");
      const iv        = crypto.randomBytes(16);
      const cipher    = crypto.createCipheriv("aes-256-cbc", keyBuffer, iv);
      const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);

      // Format: "<iv_hex>:<ciphertext_hex>"
      const ssoToken = iv.toString("hex") + ":" + encrypted.toString("hex");

      res.json({ success: true, ssoToken });
    } catch (err) {
      console.error("generate-sso-token error:", err);
      res.status(500).json({ success: false, message: "Failed to generate SSO token" });
    }
  }
);

export default router;
```

### Register the route

In your main `app.js` / [index.js]/ `server.js` (wherever you add routes), add:

```js
import playerSsoRoutes from "./routes/playerSso.js";

// Add alongside your other routes:
app.use("/api/player", playerSsoRoutes);
```

After this, the full path will be:
`POST https://your-api.com/api/player/generate-sso-token`

---

## Change 2 — Frontend: Games Page

update your current Games page with the code below.

### Env vars to add (`frontend/.env`)

```env
# Our main game site (Keno)
VITE_GAME_BASE_URL=https://game.mrx.com

# Aviator — runs on its own domain
VITE_AVIATOR_URL=https://aviator.mrx.com

# Bingo — runs on its own domain
VITE_BINGO_URL=https://bingo.mrx.com
```

> We will give you the real production URLs. For local testing, use `http://localhost:4505`, `http://localhost:4402`, `http://localhost:4404`.


### Sample Games Page Code

```jsx
import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";


// ──────────────────────────────────────────────────────────────────────────

const GAME_BASE_URL = import.meta.env.VITE_GAME_BASE_URL || "http://localhost:4505";
const AVIATOR_URL   = import.meta.env.VITE_AVIATOR_URL   || "http://localhost:4402";
const BINGO_URL     = import.meta.env.VITE_BINGO_URL     || "http://localhost:4404";

const apiBaseUrl = import.meta.env.VITE_API_URL || "http://localhost:3000";

const GAMES = [
  {
    id: "keno", name: "Keno", description: "Pick your lucky numbers",
    emoji: "🎱", gradient: "from-purple-500/30 to-violet-700/40",
    border: "border-purple-500/30", accent: "#a855f7",
    ssoTarget: GAME_BASE_URL, path: "/game/keno",
  },
  {
    id: "aviator", name: "Aviator", description: "Cash out before the plane flies away",
    emoji: "✈️", gradient: "from-sky-500/30 to-cyan-700/40",
    border: "border-sky-500/30", accent: "#0ea5e9",
    ssoTarget: AVIATOR_URL, path: "",  // Aviator uses its own root path
  },
  {
    id: "bingo", name: "Bingo", description: "Mark your card and shout Bingo!",
    emoji: "🎰", gradient: "from-yellow-500/30 to-amber-700/40",
    border: "border-yellow-500/30", accent: "#f59e0b",
    ssoTarget: BINGO_URL, path: "",
  },
];

/** Calls your backend to get a fresh SSO token */
async function generateSsoToken() {
  const token = localStorage.getItem("token") || sessionStorage.getItem("token");
  if (!token) throw new Error("Not logged in");

  const res = await fetch(`${apiBaseUrl}/api/player/generate-sso-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success)
    throw new Error(data.message || "Failed to get SSO token");
  return data.ssoToken;
}

export default function Games() {
  const navigate = useNavigate();
  const [launching, setLaunching] = useState(null);
  const [error, setError]         = useState(null);
  const [loggedIn, setLoggedIn]   = useState(hasAuthToken());

  // Keep login state in sync if user logs in/out elsewhere
  useEffect(() => {
    const sync = () => setLoggedIn(hasAuthToken());
    window.addEventListener("authSessionUpdated", sync);
    return () => window.removeEventListener("authSessionUpdated", sync);
  }, []);

  const launchGame = useCallback(async (game) => {
    setError(null);
    if (!loggedIn) { navigate("/login"); return; }

    setLaunching(game.id);
    try {
      const ssoToken  = await generateSsoToken();
      const targetUrl = new URL(game.path || "/", game.ssoTarget);
      targetUrl.searchParams.set("sso_token", ssoToken);
      window.open(targetUrl.toString(), "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err.message || "Could not launch game. Please try again.");
    } finally {
      setLaunching(null);
    }
  }, [loggedIn, navigate]);

  return (
      <div className="relative px-3 py-5 sm:px-5">
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute left-1/2 top-0 h-64 w-[min(100%,52rem)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(1,144,82,0.12),transparent_70%)] blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-4xl">
          <h1 className="mb-1 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            🎮 Casino Games
          </h1>
          <p className="mb-6 text-sm text-white/55">
            Play all games using your Bet wallet balance. Click a game to launch it with your account automatically signed in.
          </p>

          {/* Error banner */}
          {error && (
            <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <span className="text-base">⚠️</span>
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError(null)}
                className="ml-auto shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/20">
                Dismiss
              </button>
            </div>
          )}

          {/* Not logged in banner */}
          {!loggedIn && (
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
              <span>🔒</span>
              <span>
                Please{" "}
                <button type="button" onClick={() => navigate("/login")}
                  className="font-semibold text-[#019052] underline underline-offset-2">
                  log in
                </button>{" "}
                to play games with your Bet wallet.
              </span>
            </div>
          )}

          {/* Game cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {GAMES.map((game) => {
              const isLaunching = launching === game.id;
              return (
                <button
                  key={game.id}
                  type="button"
                  disabled={isLaunching}
                  onClick={() => launchGame(game)}
                  className={`group relative flex flex-col items-start gap-2 overflow-hidden rounded-2xl border bg-gradient-to-br ${game.gradient} ${game.border} p-4 text-left shadow-lg transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_24px_0_rgba(0,0,0,0.35)] active:translate-y-0 disabled:opacity-70 disabled:cursor-wait`}
                >
                  {/* Shimmer hover effect */}
                  <div className="pointer-events-none absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-0 transition-all duration-500 group-hover:translate-x-[100%] group-hover:opacity-100" />

                  <span className="text-3xl leading-none sm:text-4xl">{game.emoji}</span>
                  <span className="font-bold text-white sm:text-lg">{game.name}</span>
                  <span className="text-[11px] leading-snug text-white/60 sm:text-xs">{game.description}</span>

                  <span
                    className="mt-auto inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                    style={{ backgroundColor: game.accent + "55" }}
                  >
                    {isLaunching ? (
                      <>
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                        Loading…
                      </>
                    ) : (
                      <>▶ Play Now</>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-6 text-center text-xs text-white/30">
            Games open in a new tab. Your Bet wallet balance is used automatically.
          </p>
        </div>
      </div>
  );
}
```

---

## Verification Checklist

After making both changes, test this flow manually:

- [ ] Log in as a player on your Bet app
- [ ] Go to the Games page — you should see 6 game cards
- [ ] Click any game card — a new tab should open with `?sso_token=...` in the URL
- [ ] The game should load with the player **already logged in** (no second login screen)
- [ ] Log out of Bet, go back to Games — clicking a game should redirect to `/login`

If step 3 works but the game shows "invalid token", send us the raw token value so we can debug the decryption on our end.

---

## Change 3 — Backend: Balance Bridge Endpoint

This is the most critical part of the integration. **Every time a player places a bet or wins in one of our games, we call your backend to deduct or credit their Bet wallet.**

We never touch your database directly. We call one HTTP endpoint you expose, and you handle the wallet update.

### How it works

```
Player bets 50 ETB on keno
        │
        ▼
Our game backend  →  POST /api/internal/wallet/adjust-balance  →  Your backend
                      { phone: "0912345678", type: "GAME_FEE", amount: 50 }
                                                                      │
                                                               Deduct 50 from wallet
                                                               Log transaction
                                                               Return { newBalance }
        │
        ▼  (player wins 120 ETB)
Our game backend  →  POST /api/internal/wallet/adjust-balance  →  Your backend
                      { phone: "0912345678", type: "GAME_WINNING", amount: 120 }
                                                                      │
                                                               Credit 120 to wallet
                                                               Log transaction
                                                               Return { newBalance }
```

### Shared Internal API Key

This endpoint must **not** be publicly accessible. It is protected by a secret key that only our server knows. Add this to your backend `.env`:

```env
INTERNAL_BRIDGE_KEY=mrx-internal-bridge-key-change-in-production
```

> [!IMPORTANT]
> Tell us this key value — we must set the same value on our side so our requests are accepted. Or generate your own strong random string and share it with us.

### Endpoint to Create

```
POST /api/internal/wallet/adjust-balance
Header: x-api-key: <INTERNAL_BRIDGE_KEY>
Content-Type: application/json

Body:
{
  "phone":  "0912345678",       // player's phone number (used as identifier)
  "type":   "GAME_FEE",         // "GAME_FEE" = deduct  |  "GAME_WINNING" = credit
  "amount": 50                  // always a positive number
}

Success response:
{ "success": true, "newBalance": 1450.00 }

Error responses:
{ "success": false, "message": "Insufficient balance" }   // 400
{ "success": false, "message": "User not found" }         // 404
{ "success": false, "message": "Forbidden" }              // 403 (wrong API key)
```

### Rules your endpoint must enforce

| Rule | Detail |
|------|--------|
| **Validate the API key** | Reject with 403 if `x-api-key` header doesn't match `INTERNAL_BRIDGE_KEY` |
| **`GAME_FEE`** | Deduct `amount` from wallet. Return 400 if balance is insufficient — **do not allow negative balances** |
| **`GAME_WINNING`** | Credit `amount` to wallet. Always succeeds if user exists |
| **Log the transaction** | Write a record to your transactions table for both types |
| **Return `newBalance`** | We cache this on our side so we can show the player their updated balance without an extra round-trip |

### Implementation (Node.js / Express)

Create a new file — e.g. `routes/internalWallet.js`:

```js
import express from "express";

const router = express.Router();

// ── Middleware: only our game backend can call this ─────────────────────────
function verifyInternalKey(req, res, next) {
  const key = req.headers["x-api-key"];
  if (!key || key !== process.env.INTERNAL_BRIDGE_KEY) {
    return res.status(403).json({ success: false, message: "Forbidden: Invalid internal API key" });
  }
  next();
}

/**
 * POST /api/internal/wallet/adjust-balance
 * Called by our game backend to debit (GAME_FEE) or credit (GAME_WINNING) a player's wallet.
 */
router.post("/adjust-balance", verifyInternalKey, async (req, res) => {
  const { phone, type, amount } = req.body;

  // ── Validation ─────────────────────────────────────────────────────────────
  if (!phone || !type || !amount)
    return res.status(400).json({ success: false, message: "phone, type, and amount are required" });

  const parsedAmount = Number(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0)
    return res.status(400).json({ success: false, message: "amount must be a positive number" });

  if (!["GAME_FEE", "GAME_WINNING"].includes(type))
    return res.status(400).json({ success: false, message: 'type must be "GAME_FEE" or "GAME_WINNING"' });

  try {
    // ── Find player by phone ──────────────────────────────────────────────────
    // Replace with your ORM / query style:
    const user = await YourUserModel.findOne({ phone });
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    // ── Get the player's wallet ───────────────────────────────────────────────
    // Adapt to your wallet structure. If balance is directly on the user record,
    // use user.balance instead.
    const wallet = await YourWalletModel.findOne({ userId: user.id, type: "PLAYER" });
    if (!wallet)
      return res.status(404).json({ success: false, message: "Player wallet not found" });

    let newBalance;

    if (type === "GAME_FEE") {
      // ── Deduct ───────────────────────────────────────────────────────────────
      if (parseFloat(wallet.balance) < parsedAmount)
        return res.status(400).json({ success: false, message: "Insufficient balance" });

      wallet.balance = parseFloat(wallet.balance) - parsedAmount;
      await wallet.save();
      newBalance = wallet.balance;

      // Log the transaction (adapt field names to your schema):
      await YourTransactionModel.create({
        walletId:    wallet.id,
        amount:      -parsedAmount,
        type:        "GAME_FEE",
        description: "Game stake — MRX platform",
        reference:   `GAME-FEE-${phone}-${Date.now()}`,
      });

    } else {
      // ── Credit ───────────────────────────────────────────────────────────────
      wallet.balance = parseFloat(wallet.balance) + parsedAmount;
      await wallet.save();
      newBalance = wallet.balance;

      await YourTransactionModel.create({
        walletId:    wallet.id,
        amount:      parsedAmount,
        type:        "GAME_WINNING",
        description: "Game winning — MRX platform",
        reference:   `GAME-WIN-${phone}-${Date.now()}`,
      });
    }

    return res.json({ success: true, newBalance });

  } catch (err) {
    console.error("internal wallet adjust error:", err);
    return res.status(500).json({ success: false, message: err.message || "Internal server error" });
  }
});

export default router;
```

### Register the route

```js
import internalWalletRoutes from "./routes/internalWallet.js";

// Mount WITHOUT your normal JWT middleware — it's protected by the API key instead:
app.use("/api/internal/wallet", internalWalletRoutes);
```

> [!WARNING]
> Do **not** apply your regular player JWT middleware to this route. The caller is our server, not a browser. Authentication is via the `x-api-key` header only.

### Also add to your `.env`

```env
INTERNAL_BRIDGE_KEY=mrx-internal-bridge-key-change-in-production
```

---

## Summary of All Changes

| File | Action |
|------|--------|
| `backend/.env` | Add `MRX_ENCRYPTION_KEY`, `INTERNAL_BRIDGE_KEY` |
| `backend/routes/playerSso.js` | **Create new** — SSO token generator |
| `backend/routes/internalWallet.js` | **Create new** — balance debit/credit bridge |
| `backend/app.js` (or similar) | Register both new routes |
| `frontend/.env` | Add `VITE_GAME_BASE_URL`, `VITE_AVIATOR_URL`, `VITE_BINGO_URL` |
| `frontend/src/pages/Games.jsx` | **Replace** with the Games page code above |

## Full Verification Checklist

**SSO (login):**
- [ ] Log in as a player → go to Games page → click any game → new tab opens with `?sso_token=...` in URL → player is automatically logged into the game

**Balance bridge:**
- [ ] Use a REST client (Postman, curl) to call `POST /api/internal/wallet/adjust-balance` with the correct `x-api-key` and `{ phone, type: "GAME_FEE", amount: 10 }` → player balance decreases by 10
- [ ] Repeat with `type: "GAME_WINNING"` → balance increases
- [ ] Call without the API key → receives `403 Forbidden`
- [ ] Call `GAME_FEE` with amount greater than balance → receives `400 Insufficient balance`

---

*Questions? Reach out and I'll adapt any snippet to fit your stack.*

*Last updated: July 2026*
