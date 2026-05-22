# Frontend VPS deployment (Vite SPA + nginx)

The public **frontend** app is a **static React SPA** built with **Vite**. Production deploy means: **`npm run build`** → upload the **`dist/`** folder → serve it with **nginx** (HTTPS, gzip, SPA `try_files` fallback).

The frontend talks to the **backend REST API** on a separate host (see [`BACKEND-VPS-DEPLOYMENT.md`](./BACKEND-VPS-DEPLOYMENT.md)).

---

## Architecture (quick reference)

| Piece            | Role                                                                                |
| ---------------- | ----------------------------------------------------------------------------------- |
| **Built assets** | HTML/JS/CSS in `frontend/dist/` after `vite build`                                  |
| **nginx**        | Serves static files + routes all unknown paths to `index.html` (client-side router) |
| **TLS**          | Let’s Encrypt (Certbot), same pattern as backend                                    |
| **API**          | HTTPS origin like `https://kizza-api.sheqaygames.com` — injected at **build time**  |

**Important:** Vite bakes **`VITE_*`** values into the JS bundle during **`npm run build`**. If you change API URL or poll settings, **rebuild and redeploy** `dist/`.

---

## Prerequisites

- Backend API reachable from browsers (HTTPS, CORS acceptable for your origins).
- A hostname for the site (examples: **`https://sheqaygames.com`**, **`https://bet.your-domain.com`**).
- **Node.js 20+** (or CI) wherever you build — Ubuntu LTS bundles can use [NodeSource](https://github.com/nodesource/distributions) or `nvm` if needed.
- Optionally the same Ubuntu VPS already running nginx for the backend — add **another server block** (different `server_name`).

---

## 1. Configure build-time environment

From the **`frontend/`** directory, variables are read from **`.env`**, **`.env.production`**, etc. Only names prefixed with **`VITE_`** are exposed to the app.

Create **`frontend/.env.production`** (do not commit secrets that do not belong in the repo unless your workflow allows it):

```env
# Required in production — public API root (scheme + host, optionally with port).
# With or without trailing /api — the app normalizes (see frontend/src/services/api.js).
VITE_API_URL=https://kizza-api.sheqaygames.com

# Optional (defaults shown in code if omitted)
# VITE_USE_FIXTURES_BY_DATE=true
# VITE_MAX_PREMATCH_DAYS=14
# VITE_PREMATCH_POLL_MS=90000
```

If **`VITE_API_URL`** is missing at build time, `getApiOrigin()` falls back to **`http://localhost:3000`**, which is wrong for production — **always set it for prod builds.**

---

## 2. Build

```bash
cd frontend
npm ci           # or: npm install
npm run build
```

Output: **`frontend/dist/`**.

Smoke-test locally (optional):

```bash
npm run preview -- --host 127.0.0.1 --port 4173
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4173/
```

---

## 3. Publish `dist/` to the server

Typical layout on the VPS:

```bash
sudo mkdir -p /var/www/sokasport-frontend
# from your dev machine or CI:
rsync -avz --delete frontend/dist/ user@your-vps:/var/www/sokasport-frontend/
```

Or build **on the VPS** after `git pull`:

```bash
cd /path/to/repo/frontend
npm ci && npm run build
sudo rsync -av --delete dist/ /var/www/sokasport-frontend/
```

Adjust paths and user as needed.

---

## 4. nginx (static site + SPA fallback)

Example file in the repo: **`deploy/nginx/sokasport-frontend.example.conf`**.

Install (replace domain and root path):

```bash
sudo cp /path/to/repo/deploy/nginx/sokasport-frontend.example.conf /etc/nginx/sites-available/sokasport-frontend.conf
sudo nano /etc/nginx/sites-available/sokasport-frontend.conf   # server_name, root
sudo ln -sf /etc/nginx/sites-available/sokasport-frontend.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

The critical SPA rule is:

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

---

## 5. HTTPS (Certbot)

After DNS points to the server and HTTP serves the site:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d www.your-domain.com -d your-domain.com
```

Use the same **UFW** pattern as the backend doc: allow **OpenSSH** and **Nginx Full** (80 + 443).

---

## 6. Verification

| Check              | Command / action                                                                 |
| ------------------ | -------------------------------------------------------------------------------- |
| Static root        | Open `https://your-domain/` in a browser — app shell loads                       |
| Deep link          | Navigate directly to `https://your-domain/live` — should not 404 (**try_files**) |
| API calls          | Browser devtools → Network: XHR targets your API host, **200** on key routes     |
| Wrong API fallback | Build **without** `VITE_API_URL` → bundle still calls localhost → **avoid**      |

---

## 7. Troubleshooting

| Symptom                              | Likely fix                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Blank page / failed chunk load       | Wrong **base URL** deployment path; ensure assets load from `/assets/...` on same origin |
| **404** on refresh for `/some/route` | Missing **`try_files ... /index.html`** in nginx                                         |
| CORS errors                          | Backend **`Access-Control-Allow-Origin`** — ensure API allows your frontend origin       |
| Calls go to `localhost`              | Rebuild with **`VITE_API_URL`** in **`.env.production`**                                 |

---

## 8. Operational cheatsheet

| Task        | Steps                                                              |
| ----------- | ------------------------------------------------------------------ |
| New API URL | Edit **`.env.production`**, `npm run build`, redeploy **`dist/`**  |
| Logs        | Frontend has no server logs — nginx `access_log` / `error_log`     |
| Rollback    | Keep previous **`dist`** tarball or symlink `current` / `releases` |

---

## Referenced repo files

| Path                                           | Purpose                          |
| ---------------------------------------------- | -------------------------------- |
| `frontend/package.json`                        | `build`, `preview` scripts       |
| `frontend/src/services/api.js`                 | **`VITE_API_URL`** normalization |
| `frontend/src/hooks/useMatches.js`             | Optional **`VITE_*`** tuning     |
| `deploy/nginx/sokasport-frontend.example.conf` | nginx template                   |

---

## Checklist

- [ ] **`VITE_API_URL`** set for production build
- [ ] **`npm run build`** succeeds
- [ ] **`dist/`** synced to **`/var/www/...`**
- [ ] nginx **SPA** `try_files` in place
- [ ] TLS works (HTTPS)
- [ ] Firewall allows 80 / 443
- [ ] Manual test: open site + hard-refresh deep link
- [ ] Backend [`BACKEND-VPS-DEPLOYMENT.md`](./BACKEND-VPS-DEPLOYMENT.md) deployed and healthy
