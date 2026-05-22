# Backend VPS deployment (Docker, MongoDB, Redis, nginx)

This document summarizes the VPS deployment workflow for the backend API: **Docker Compose production stack**, **Ubuntu + nginx reverse proxy**, **HTTPS**, **database seeding pitfalls**, and **how to verify** everything is healthy.

---

## Conversation summary

1. **Stack**: Production deploy uses `docker-compose.prod.yml` — MongoDB 7 as a single-node replica set (`rs0`), Redis 7 with AOF, **backend** (API on localhost-only `3001`), and **worker** (BullMQ / API Football jobs). Mongo and Redis are **not** published to the host; only the API is reachable on `127.0.0.1:3001` for nginx.
2. **nginx**: Example site `deploy/nginx/kizza-api.conf` proxies **`kizza-api.sheqaygames.com`** → `127.0.0.1:3001`, with a **`/nginx-health`** route answered by nginx (not Node).
3. **Seeding on the VPS**: Running `node prisma/seed.js` directly on the host failed when dependencies were missing (`npm i` fixes `dotenv`) and when **`DATABASE_URL` was unset** or pointed at **`mongo:27017`** (that hostname exists only inside Docker). Prefer **`docker compose ... exec backend npx prisma db seed`** after `db push`.

---

## Architecture (quick reference)

| Component | Role | Public exposure |
|-----------|------|----------------|
| **mongo** | Prisma datastore, replica set `rs0` | No (Docker network only) |
| **redis** | Cache / queues | No (Docker network only) |
| **backend** | HTTP API (`index.js`), port `3001` | Via host: **127.0.0.1:3001** only |
| **worker** | Cron / jobs (`worker.js`) | None |
| **nginx** | TLS termination, proxy to Node | Ports **80/443** (configure firewall) |

Compose **overrides** `DATABASE_URL`, `REDIS_URL`, **`ENABLE_API_FOOTBALL_CRON=true`**, and **`RUN_WORKER_INLINE=false`** on **`backend`** so `index.js` runs **`runBootstrap()`** on startup (initial fixture queue). The **worker** container keeps the same ingestion flag. Other secrets live in **`backend/.env`** (from `backend/.env.production.example`).

---

## Prerequisites

- Ubuntu VPS (example steps below use Ubuntu-style packages).
- A domain/subdomain pointing at the server (example: **`kizza-api.sheqaygames.com`** → server IPv4 A record).
- SSH access as a user with `sudo`.

---

## 1. Install Docker Engine and Compose plugin

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Verify:

```bash
docker --version
docker compose version
```

*(On Debian or non-Ubuntu, use Docker’s distro-specific repo instructions.)*

---

## 2. Clone the repository and configure environment

Replace the clone path and URL with yours.

```bash
cd /opt   # or e.g. ~/apps
git clone <your-repo-url> <your-app-folder> && cd <your-app-folder>

cp backend/.env.production.example backend/.env
nano backend/.env   # JWT_SECRET, API_FOOTBALL_KEY, etc.
```

**Important:**

- Compose injects **`DATABASE_URL`** / **`REDIS_URL`** into containers; you normally **do not** duplicate internal URLs in `.env` unless you customize compose.
- For **MongoDB Atlas** instead of bundled Mongo: remove or adjust the `mongo` service and set `DATABASE_URL` in `.env`; remove compose `environment` overrides for DB as needed — not covered step-by-step here.

---

## 3. Start the production stack

From **repository root** (where `docker-compose.prod.yml` lives):

```bash
chmod +x scripts/deploy-vps.sh
./scripts/deploy-vps.sh
```

Equivalent manual command:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

---

## 4. First-time database: schema + optional seed

Run **inside** the `backend` container so `DATABASE_URL` uses the hostname **`mongo`** on the Compose network:

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma db push
docker compose -f docker-compose.prod.yml exec backend npx prisma db seed
```

**Do not rely on running seed on the host** unless **`backend/.env`** has a `DATABASE_URL` your **host** can resolve (e.g. `127.0.0.1` with Mongo port published — not the default). The hostname **`mongo`** only works inside Docker.

On the host, after `cd backend && npm i`, you can use:

```bash
npm run db:seed
```

only if **`DATABASE_URL`** is valid **from that machine** — same rules as above.

---

## 5. Firewall (UFW example)

Allow SSH and HTTP/HTTPS; **do not** expose Mongo (`27017`) or Redis (`6379`) publicly.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # 80 + 443
sudo ufw enable
sudo ufw status
```

---

## 6. nginx reverse proxy (Ubuntu)

Install nginx:

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

Install the sample site config (adjust path to your repo clone):

```bash
sudo cp /path/to/your/repo/deploy/nginx/kizza-api.conf /etc/nginx/sites-available/kizza-api.conf
sudo ln -sf /etc/nginx/sites-available/kizza-api.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

If the **default** site still answers on port 80 and steals your hostname:

```bash
sudo unlink /etc/nginx/sites-enabled/default   # only if needed
sudo nginx -t && sudo systemctl reload nginx
```

---

## 7. HTTPS with Let’s Encrypt (Certbot)

After DNS resolves to this server and **HTTP** works:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d kizza-api.sheqaygames.com
```

Certbot will install certificates and typically adjust the server block.

---

## 8. Frontend / admin apps

Point your API base URL to **`https://kizza-api.sheqaygames.com`** (`VITE_*` or equivalent). The backend historically used permissive CORS (`origin: "*"`); tighten for production when you pin allowed origins.

---

## 9. How to verify deployment

Run these in order.

### 9.1 API health (Mongo + Redis + Node)

On the VPS:

```bash
curl -sS http://127.0.0.1:3001/health
```

Expect JSON similar to **`"status":"ok"`** and **`"redis":"up"`**. If **`redis`** is **`down`**, fix Redis service or **`REDIS_URL`**.

Through the public hostname (HTTPS after Certbot):

```bash
curl -sS https://kizza-api.sheqaygames.com/health
```

HTTP only (before TLS):

```bash
curl -sS http://kizza-api.sheqaygames.com/health
```

### 9.2 nginx only (does not hit Node)

```bash
curl -sS https://kizza-api.sheqaygames.com/nginx-health
```

Expect **`ok`** (or whatever your `kizza-api.conf` returns).  
If this fails but DNS is correct → nginx/site config issue.  
If this works but **`/health`** fails → proxy to `127.0.0.1:3001` or backend container issue.

### 9.3 Containers

```bash
cd /path/to/your/repo
docker compose -f docker-compose.prod.yml ps
```

**mongo**, **redis**, **backend**, **worker** should be **Up**. **mongo/redis** often show **(healthy)**.

Logs:

```bash
docker compose -f docker-compose.prod.yml logs backend --tail=80
docker compose -f docker-compose.prod.yml logs worker --tail=40
```

Healthy signs: Mongo/Prisma connected, Redis connected, server listening on **3001**, worker jobs ticking without crashes.

### 9.4 Public API smoke test

Example (adjust path if your routes differ):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://kizza-api.sheqaygames.com/api/football/fixtures/today
```

Expect **200** (or your app’s normal success code), not **502/504**.

### 9.5 Interpreting common symptoms

| Symptom | Likely cause |
|--------|----------------|
| `/health` shows **`redis: down`** | Redis container or wrong **`REDIS_URL`** |
| **502/504** via domain, **OK** on `127.0.0.1:3001` | nginx upstream, wrong port, or backend not bound to localhost |
| **OK** locally, fails in browser | DNS, TLS, firewall, wrong API URL in client |
| Container **Exited** | Inspect `docker compose logs <service>` |
| Worker **`fixtures to process: 0`** | Often **data/ingestion**/filters — not necessarily a broken deployment |

---

## 10. Optional changes

### Expose Node directly on all interfaces (not recommended for production)

In `docker-compose.prod.yml`, change:

`127.0.0.1:3001:3001` → `3001:3001`

Prefer keeping **localhost-only** and using nginx for TLS.

### MongoDB Atlas

Omit the `mongo` service, set **`DATABASE_URL`** in `backend/.env`, remove compose **`DATABASE_URL`** overrides for `backend`/`worker`, and adjust **`depends_on`** as needed.

---

## 11. Operational commands (cheatsheet)

| Task | Command |
|------|---------|
| Rebuild and start | `./scripts/deploy-vps.sh` or `docker compose -f docker-compose.prod.yml up -d --build` |
| Apply schema | `docker compose -f docker-compose.prod.yml exec backend npx prisma db push` |
| Seed DB | `docker compose -f docker-compose.prod.yml exec backend npx prisma db seed` |
| Backend logs | `docker compose -f docker-compose.prod.yml logs -f backend` |
| Worker logs | `docker compose -f docker-compose.prod.yml logs -f worker` |
| Reload nginx | `sudo nginx -t && sudo systemctl reload nginx` |

---

## Related guides

| App | Deploy manual |
|-----|----------------|
| Storefront SPA | **[`deploy/FRONTEND-VPS-DEPLOYMENT.md`](./FRONTEND-VPS-DEPLOYMENT.md)** |
| Admin panel SPA | **[`deploy/ADMIN-VPS-DEPLOYMENT.md`](./ADMIN-VPS-DEPLOYMENT.md)** |

---

## Files referenced in this guide

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Production Mongo, Redis, backend, worker |
| `backend/Dockerfile` | Image build for backend + worker |
| `backend/.env.production.example` | Template → copy to **`backend/.env`** |
| `scripts/deploy-vps.sh` | Build + start prod compose |
| `deploy/nginx/kizza-api.conf` | Example nginx reverse proxy |

---

## Checklist before calling it done

- [ ] DNS A record points to the VPS  
- [ ] `backend/.env` filled with secrets (JWT, API keys, etc.)  
- [ ] `docker compose ... ps` — all services **Up**  
- [ ] `curl http://127.0.0.1:3001/health` — **ok** / **redis up**  
- [ ] nginx + **`/nginx-health`** works  
- [ ] **`/health`** works on **`https://<your-api-domain>`**  
- [ ] **Certbot** completed (HTTPS)  
- [ ] **UFW** (or cloud firewall): 22 + 80 + 443; not 27017/6379 to the world  
- [ ] **`prisma db push`** (first deploy) + **`db seed`** if you need baseline data  

When these pass, deployment is operational; ingestion volume (fixtures, odds) is a separate tuning topic.
