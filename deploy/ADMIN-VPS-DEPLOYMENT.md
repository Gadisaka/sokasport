# Admin VPS deployment (Vite SPA + nginx)

The **admin** panel is a **static React SPA** built with **Vite**, same deployment shape as the public frontend: **`npm run build`** → **`admin/dist/`** → **nginx** with HTTPS and SPA fallback.

Unlike the storefront app, the admin app reads its **REST API base** from **`admin/constants.js`** (exported **`API_URL`**) — **not** from `import.meta.env` for the main client (optional **`VITE_*`** exist for ticket/branding texts).

---

## Architecture (quick reference)

| Piece            | Role                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Built assets** | Contents of **`admin/dist/`** after **`vite build`**                                                                     |
| **nginx**        | Static files + **`try_files`** → **`index.html`**                                                                        |
| **`API_URL`**    | Must point at the same backend as production (e.g. `https://kizza-api.sheqaygames.com/api`) — baked in at **build time** |

**Important:** Editing **`constants.js`** or adding **`.env.production`** **`VITE_*`** values requires a **rebuild** before redeploy.

---

## Prerequisites

- Backend deployed and reachable (see [`BACKEND-VPS-DEPLOYMENT.md`](./BACKEND-VPS-DEPLOYMENT.md)).
- A **restricted** hostname is recommended (**`admin.`** subdomain, VPN, or IP allowlisting) — the admin UI is sensitive.
- **Node.js** for builds (same as frontend doc).
- **nginx** (+ Certbot) on the VPS **or** a separate static host.

**Security note:** Prefer **HTTPS**, strong admin passwords, and limiting who can reach the admin **`server_name`** (firewall rules, SSO, etc.). This manual only covers hosting the static bundle.

---

## 1. Point the bundle at production API

Open **`admin/constants.js`** before building:

```js
export const API_URL = "https://kizza-api.sheqaygames.com/api";
```

`useApiRequest` prepends **`API_URL`** to paths such as **`/auth/login`** — keep the **`/api`** suffix aligned with how your backend mounts routes (`/api/...`). If unsure, mirror the commented examples already in that file.

**Optional** — ticket / receipt copy (also build-time **`VITE_`**):

- **`VITE_SHOP_NAME`**
- **`VITE_SHOP_TAGLINE`**

Used in **`admin/src/components/ticket/`** (e.g. `TicketTemplate.jsx`, `escpos.js`). Set them in **`admin/.env.production`**:

```env
VITE_SHOP_NAME=Your shop name
VITE_SHOP_TAGLINE=Bet responsibly. 18+
```

---

## 2. Dev proxy vs production

`admin/vite.config.js` configures a **development** proxy from **`/api`** → **`http://localhost:3001`**. That affects **`npm run dev` only**. Production **`fetch`** URLs come from **`API_URL`** above.

---

## 3. Build

```bash
cd admin
npm ci           # or: npm install
npm run build
```

Output: **`admin/dist/`**.

---

## 4. Publish `dist/` to the VPS

Example target directory:

```bash
sudo mkdir -p /var/www/sokasport-admin
rsync -avz --delete admin/dist/ user@your-vps:/var/www/sokasport-admin/
```

Or build on the server:

```bash
cd /path/to/repo/admin
npm ci && npm run build
sudo rsync -av --delete dist/ /var/www/sokasport-admin/
```

---

## 5. nginx

Example:** `deploy/nginx/sokasport-admin.example.conf`**

Install:

```bash
sudo cp /path/to/repo/deploy/nginx/sokasport-admin.example.conf /etc/nginx/sites-available/sokasport-admin.conf
sudo nano /etc/nginx/sites-available/sokasport-admin.conf
sudo ln -sf /etc/nginx/sites-available/sokasport-admin.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Ensure SPA fallback exists:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

---

## 6. HTTPS & firewall

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d admin.your-domain.com
```

Allow **SSH** + **HTTPS**(**Nginx Full**) on **UFW**; consider restricting source IPs if only staff should load the panel.

---

## 7. Verification

| Check                  | Action                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Login                  | Open admin URL → login form loads                                                        |
| Login request          | Browser Network → **`POST`** to **`API_URL`/…** returns **200** or expected auth payload |
| Client-side navigation | Navigate to an internal route, hard refresh — **no** nginx **404**                       |
| Ticket strings         | Receipts show **`VITE_SHOP_NAME`** if set                                                |

---

## 8. Troubleshooting

| Symptom                                            | Likely fix                                                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **`ERR_CONNECTION_REFUSED`** to `localhost:3001`   | **`constants.js`** still default dev URL → set prod **`API_URL`**, rebuild                                       |
| **404** `/api/...` in browser pointing at SPA host | **`API_URL`** must be full backend URL (includes **`/api`**) matching backend mount                              |
| **401/403** from API                               | Credentials / JWT / backend auth — not a static hosting bug                                                      |
| CORS failures                                      | Tune backend origins if you lock down **`Access-Control-Allow-Origin`** (admin uses **fetch** like the frontend) |

---

## 9. Operational cheatsheet

| Task                   | Steps                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Change API hostname    | **`admin/constants.js`** → **`npm run build`** → redeploy **`dist/`**                      |
| Branding text          | **`admin/.env.production`** `VITE_*` → rebuild                                             |
| Same VPS as storefront | Separate **`server_name`**, separate **`root`**, separate Certbot **`certonly`/`--nginx`** |

---

## Referenced repo files

| Path                                        | Purpose                                    |
| ------------------------------------------- | ------------------------------------------ |
| `admin/constants.js`                        | **`API_URL`** production target            |
| `admin/vite.config.js`                      | Dev server port **5174**, dev proxy `/api` |
| `admin/src/hook/useApiRequest.js`           | Uses **`API_URL`**                         |
| `deploy/nginx/sokasport-admin.example.conf` | nginx template                             |

---

## Checklist

- [ ] **`API_URL`** in **`constants.js`** set to HTTPS API + **`/api`** path
- [ ] **`npm run build`** succeeds
- [ ] **`dist/`** deployed under **`/var/www/...`**
- [ ] nginx **`try_files`** SPA rule
- [ ] HTTPS enabled
- [ ] Access narrowed if possible (subdomain / IP / VPN)
- [ ] Smoke test login + one protected route
- [ ] Backend **[`BACKEND-VPS-DEPLOYMENT.md`](./BACKEND-VPS-DEPLOYMENT.md)** verified (`/health`, etc.)
