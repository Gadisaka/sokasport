# Phone number normalization — local vs international duplicate-account fix

**Status:** Implemented (2026-06-02)  
**Last reviewed:** 2026-06-02

---

## Executive summary

A player registering with `0911223344` and another registering with `+251911223344` were
created as **two different accounts**, even though they are the same phone number. The same
defect let a cashier fail to find a player when they typed the number in a different format
than the one stored.

Root cause: phone numbers were stored and looked up with only `String(phone).trim()` — no
canonicalization — while the database enforces uniqueness on the raw stored value
(`User.phone @unique`). A correct Ethiopian-phone normalizer already existed in the codebase
but was only used by the online-deposit flow.

The fix introduces a shared `lib/phone.js` module and applies the normalizer at **every**
point a phone is **stored** or **looked up** (registration, login, profile update, admin user
creation, cashier creation, agent creation, and cashier-side player lookups). After the fix,
all accepted formats of one number collapse to a single canonical form `251XXXXXXXXX`, so the
unique constraint does its job and lookups always hit the right account.

---

## Symptom

| Observation | Detail |
|-------------|--------|
| When | Registering / logging in / cashier searching a player by phone |
| Example | `0911223344` and `+251911223344` treated as different users |
| Example | `0700112233` and `+251700112233` treated as different users |
| Effect 1 | Duplicate player accounts for the same real number |
| Effect 2 | Login fails if the user types a different format than at registration |
| Effect 3 | Cashier "Player not found" when typing `09…` for a player stored as `251…` |

---

## Accepted phone formats (Ethiopia, country code +251)

All of these refer to the **same** subscriber and must be treated as equal:

| Input | Meaning |
|-------|---------|
| `0911223344` | Local format, mobile `09` prefix |
| `0700112233` | Local format, mobile `07` prefix |
| `+251911223344` | International format with `+` |
| `251911223344` | International format without `+` |
| `911223344` | Bare 9-digit national number |
| `09 11 22 33 44`, `(0911) 223344`, `+251-911-22-33-44` | Same numbers with spacing/punctuation |

Canonical stored form: **digits only, `251XXXXXXXXX`** (e.g. `251911223344`).

---

## Root cause

### 1. Storage never canonicalized

Registration stored the raw trimmed string:

```js
// backend/controllers/playerController.js (before)
phone: String(phone).trim(),
email: `${String(phone).trim()}@player.local`,
```

So `0911223344` and `+251911223344` were two distinct strings → two distinct rows under the
`@unique` index.

### 2. Lookups never canonicalized

Login and cashier player-lookup also used only `.trim()`:

```js
// backend/controllers/authController.js (before)
const normalizedPhone = phone ? String(phone).trim() : null; // misnamed — not normalized
const user = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
```

A user who registered as `0911223344` could not log in by typing `+251911223344`.

### 3. A correct normalizer existed but was siloed

`normalizeEthiopiaPhone()` lived in `backend/lib/onlineDepositVerify.js` and was used **only**
for building deposit ledger references — never imported by auth/registration/admin code.

```js
export function normalizeEthiopiaPhone(input) {
  let d = String(input ?? "").replace(/\D/g, ""); // strip all non-digits
  if (d.startsWith("0")) d = `251${d.slice(1)}`;  // 09xx… -> 2519xx…
  if (d.length === 9) d = `251${d}`;              // bare 9-digit -> 251 + digits
  return d;
}
```

---

## Fix

### Rule (portable)

> Canonicalize a phone number to a single form at **every write** and **every lookup**.
> Store the canonical form; never persist a raw client string when a `@unique` constraint
> (or any dedup logic) depends on it.

### 1. New shared module — `backend/lib/phone.js`

The normalizer was moved out of the deposit file into a dedicated module, and a null-safe
wrapper added for optional-phone flows:

```js
// backend/lib/phone.js
export function normalizeEthiopiaPhone(input) {
  let d = String(input ?? "").replace(/\D/g, "");
  if (d.startsWith("0")) d = `251${d.slice(1)}`;
  if (d.length === 9) d = `251${d}`;
  return d;
}

// Returns null for empty/blank input, for optional-phone flows where an
// absent phone must stay null rather than become "".
export function normalizePhoneOrNull(input) {
  const normalized = normalizeEthiopiaPhone(input);
  return normalized ? normalized : null;
}
```

`onlineDepositVerify.js` now imports and **re-exports** `normalizeEthiopiaPhone` from
`./phone.js`, so the existing deposit-flow import keeps working unchanged.

### 2. Applied at every store/lookup site

| File | Function(s) | Change |
|------|-------------|--------|
| [backend/lib/phone.js](../backend/lib/phone.js) | — | New module: `normalizeEthiopiaPhone`, `normalizePhoneOrNull` |
| [backend/lib/onlineDepositVerify.js](../backend/lib/onlineDepositVerify.js) | — | Import + re-export from `phone.js` (no behavior change) |
| [backend/controllers/playerController.js](../backend/controllers/playerController.js) | `register` | Normalize once into `phoneNorm`; use for `phone` **and** synthetic `email` |
| [backend/controllers/authController.js](../backend/controllers/authController.js) | `login` | Normalize inbound phone before `findUnique` lookup |
| [backend/controllers/authController.js](../backend/controllers/authController.js) | `patchProfile` | Normalize new phone; compare **normalized** value to stored; sync player email |
| [backend/controllers/usersController.js](../backend/controllers/usersController.js) | `createUser`, `updateUser` | `phone: normalizePhoneOrNull(phone)` |
| [backend/controllers/agentsCashiersController.js](../backend/controllers/agentsCashiersController.js) | `createCashier`, `updateCashier`, `createAgent`, `updateAgent` | `phone: normalizePhoneOrNull(phone)` |
| [backend/controllers/cashierWalletController.js](../backend/controllers/cashierWalletController.js) | `cashierDeposit`, `getWithdrawRequest` | Normalize phone before player-by-phone `findUnique` |

**Example — registration (before → after):**

```js
// before
phone: String(phone).trim(),
email: `${String(phone).trim()}@player.local`,

// after
const phoneNorm = normalizeEthiopiaPhone(phone);
// ...
phone: phoneNorm,
email: `${phoneNorm}@player.local`,
```

**Example — profile update (compare normalized, not raw):**

```js
// after
if (!String(body.phone ?? "").trim()) {
  return res.status(400).json({ message: "Phone cannot be empty" });
}
const normalizedPhone = normalizeEthiopiaPhone(body.phone);
if (normalizedPhone !== user.phone) {        // stored value is already canonical
  data.phone = normalizedPhone;
  if (roleName === "PLAYER") data.email = `${normalizedPhone}@player.local`;
}
```

The existing `P2002` (unique-violation) catch blocks already return a clean `409`
("Phone number already registered" / "already in use"), so a duplicate attempt in **any**
format is now correctly rejected.

---

## How to apply in another project

Use this checklist for any system that stores a phone (or email, or any normalizable
identifier) under a uniqueness constraint.

### 1. Pick one canonical form and document it

Decide the single stored representation (here: digits-only `251XXXXXXXXX`). Write down which
input formats must map to it. This is a product decision, not just code.

### 2. Write one normalizer + one null-safe wrapper

Keep it pure and in a **dedicated module** (not buried in an unrelated feature file). Provide:
- `normalize(input)` → canonical string (`""` for empty).
- `normalizeOrNull(input)` → `null` for empty/blank, for optional fields.

### 3. Audit every write AND every lookup path

Search the backend for:
- `phone:` in any `create` / `update` / `data: {}` block.
- `where: { phone` in any `findUnique` / `findFirst` / `findMany`.
- Any local var like `normalizedPhone = String(x).trim()` — **a misleading name is a red
  flag**; `.trim()` is not normalization.

Common sites people miss (this fix found several beyond the obvious registration path):
- Login / authentication lookup
- Profile / account-edit update
- Admin-created users, cashiers, agents (create **and** update)
- Staff-facing "find customer by phone" lookups (deposit, withdrawal, support)

> Grep used here: `phone:\s*(String\(phone\)|phone\s*\?)|where:\s*\{\s*phone|String\(phone\)\.trim`

### 4. Normalize both sides of every comparison

If the stored value is canonical, any value you compare it against (login input, "did the
phone change?" check, dedup pre-check) **must** be normalized with the same function. Mixing
a normalized stored value with a raw input silently breaks equality.

### 5. Keep derived fields consistent

This app derives a synthetic email `${phone}@player.local`. Anything derived from the phone
must be rebuilt from the **normalized** phone, in every place the phone is written.

### 6. Existing data migration (only if you have live data)

This repo had a fresh database, so **no migration was needed**. If your DB already holds
raw-format phones, a normalize-on-write change will break logins for existing rows (their
stored value no longer matches the normalized lookup). In that case add a one-time migration
that:
1. Normalizes every stored phone (and any derived field like email).
2. **Reports collisions** — rows that collapse to the same canonical value are pre-existing
   duplicates and must be resolved manually before the `@unique` index will accept the update.

### 7. Test matrix

| Scenario | Expected |
|----------|----------|
| Register `0911223344` | 201 created, stored as `251911223344` |
| Register `+251911223344` again | **409 "already registered"** (was: 2nd account) |
| Login with `+251911223344` for account made as `0911223344` | 200 success |
| Cashier deposit lookup `09…` for player stored `251…` | Player found |
| Profile update to a different format of the same number | No change detected (no-op) |
| Optional phone left blank (admin/cashier create) | Stored as `null`, not `""` |
| `07` prefix variants | Collapse identically to `2517…` |
| Spacing / punctuation (`09 11 22 33 44`, `+251-911-…`) | Stripped to canonical |

---

## Files changed (this repo)

| File | Type | Change |
|------|------|--------|
| [backend/lib/phone.js](../backend/lib/phone.js) | New | Canonical normalizer + null-safe wrapper |
| [backend/lib/onlineDepositVerify.js](../backend/lib/onlineDepositVerify.js) | Edit | Import + re-export normalizer (backward compat) |
| [backend/controllers/playerController.js](../backend/controllers/playerController.js) | Edit | Normalize in `register` (phone + email) |
| [backend/controllers/authController.js](../backend/controllers/authController.js) | Edit | Normalize `login` lookup + `patchProfile` |
| [backend/controllers/usersController.js](../backend/controllers/usersController.js) | Edit | Normalize `createUser` + `updateUser` |
| [backend/controllers/agentsCashiersController.js](../backend/controllers/agentsCashiersController.js) | Edit | Normalize cashier/agent create + update |
| [backend/controllers/cashierWalletController.js](../backend/controllers/cashierWalletController.js) | Edit | Normalize player-by-phone lookups |
| [backend/tests/phone.test.js](../backend/tests/phone.test.js) | New | 7 unit tests (bug case, `07`/`09`, punctuation, null behavior) |

---

## Lessons for similar systems

1. **A `@unique` column is only as good as the value you put in it.** Uniqueness on a
   non-canonical string guarantees nothing — normalize before insert.
2. **Normalize at the boundary, both directions.** Every write and every lookup must pass
   through the same function, or comparisons silently miss.
3. **Beware variables named `normalizedX` that only `.trim()`.** The misleading name in
   `authController.login` hid this bug in plain sight.
4. **Don't silo a reusable helper inside one feature.** A correct normalizer already existed
   but lived in the deposit flow; auth never knew about it. Shared concerns belong in a shared
   module.
5. **Audit the long tail of lookup sites.** The most user-visible gap (cashier "player not
   found") was two lookups nobody listed in the first pass — a repo-wide grep caught them.
