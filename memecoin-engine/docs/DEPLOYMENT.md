# DEPLOYMENT

## Requirements

* Node 22+ (local) or Docker + docker-compose (VPS)
* PostgreSQL 14+ (docker-compose ships one) — Supabase works: use the **connection pooler** URL as `DATABASE_URL`
* Outbound HTTPS to: your Solana RPC, api.dexscreener.com, api.geckoterminal.com, api.rugcheck.xyz, pumpportal.fun (wss),
  api.telegram.org (alerts), www.reddit.com (optional)

## From scratch (VPS with Docker)

```bash
git clone <repo> && cd memecoin-engine
cp .env.example .env               # fill SOLANA_RPC_URL (Helius free key recommended), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, API_AUTH_TOKEN
export POSTGRES_PASSWORD=$(openssl rand -hex 16)
docker compose up -d --build       # db + engine (workers + API + dashboard on :8080)
docker compose logs -f engine
docker compose exec engine node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>r.json()).then(j=>console.log(j.workers, j.providers.map(p=>[p.id,p.status])))"
```
Migrations run automatically on boot (`store.init()`), and are idempotent.
Open `http://<vps>:8080/` (put Caddy/nginx with TLS + basic auth in front; or rely on `API_AUTH_TOKEN`).

## Local development

```bash
npm install
cp .env.example .env               # DATABASE_URL optional: without it the engine uses an in-memory store (not durable)
npm run check:sources              # verifies each API from this machine
npm run dev                        # tsx watch src/main.ts
npm test && npm run lint && npm run typecheck
```
Postgres integration tests run when `TEST_DATABASE_URL` is set (e.g. `postgres://postgres@localhost:5432/memecoin_test`).

## Configuration

* `config.yaml` — all thresholds, weights, tiers, cadences, alert limits, paper-trading parameters. Validated at boot
  (`src/config/schema.ts`, strict: unknown keys fail fast). Mounted read-only into the container.
* `.env` — secrets and endpoints only (`src/config/env.ts`). See `.env.example`.
* `DASHBOARD_URL` (optional) — used to build "VIEW TOKEN" links in alerts.

## Processes

* `node dist/main.js` — everything (recommended for one VPS).
* `node dist/api-main.js` — API/dashboard only; run `dist/main.js` elsewhere for workers. Several worker processes can share
  the database (jobs are claimed with `SKIP LOCKED`).

## Operations

* Restart policy `unless-stopped`; healthcheck on `/api/health`; JSON logs rotated by Docker.
* Retention: snapshots pruned after `monitor.snapshot_retention_days` (30); done jobs after 2 days; health after 7 days.
* Dead-letter jobs: `/health.html` → requeue, or `POST /api/queue/dead/:id/requeue`.
* Learning: proposals every 6 h; activate manually (`/paper.html` or `npx tsx src/tools/learn.ts --apply`).
* Replay/audit: `npm run replay -- <mint> [snapshotId]`.
* Cost control: public RPC is enough for tiers 1–2; a free Helius key makes tiers 3–4 comfortable (each tier-3 cycle costs
  ~15–40 RPC calls; tier-4 up to ~80).
