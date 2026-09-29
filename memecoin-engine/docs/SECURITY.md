# SECURITY — of the bot itself

## Hard guarantees (v0.1)

* **Read-only.** The engine only calls read RPC methods (`getAccountInfo`, `getTokenLargestAccounts`,
  `getSignaturesForAddress`, `getTransaction`, `getBalance`, `getSlot`) and public HTTP APIs.
* **No wallet.** There is no environment variable, config key, table or code path that stores or uses a private key.
  Search the code: no `Keypair`, no `sendTransaction`, no `signTransaction`.
* **Paper trading only.** `src/paper/engine.ts` simulates fills against stored prices. Nothing leaves the database.
* **Human in the loop.** Dashboard buttons (VIEW TOKEN / ONCHAIN / CHART / SECURITY / PAPER TRADE / WATCH / IGNORE) only
  change engine state or open external explorers. Any future real execution must be a separate, explicitly enabled module
  requiring explicit human confirmation per trade — it is intentionally not designed here.

## Secrets

* Only in `.env` (never in `config.yaml`, never logged — pino redacts `*.apiKey`, `*.token`, `*.botToken`, `*.webhookUrl`,
  `*.DATABASE_URL`).
* Optional: `HELIUS_API_KEY`, `BIRDEYE_API_KEY`, `TELEGRAM_BOT_TOKEN`, `DISCORD_WEBHOOK_URL`, `API_AUTH_TOKEN`.
* The Telegram bot token only needs `sendMessage` (+ `getChatMemberCount` for social presence). Use a dedicated bot.

## API / dashboard

* Set `API_AUTH_TOKEN` to require `Authorization: Bearer <token>` (or `?token=`) on `/api/*`. Put the dashboard behind a
  reverse proxy with TLS (Caddy/nginx) if exposed; by default docker-compose binds port 8080 on all interfaces — restrict it.
* Mint parameters are validated against a base58 regex; all SQL is parameterized; static files are served from a fixed dir.
* Response headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.

## Data trust

* Third-party reports (RugCheck) are advisory and cross-checked against on-chain reads; disagreement lowers confidence.
* Promotion feeds (DexScreener boosts/profiles) are paid placements and are used as discovery hints only.
* Social data can be botted; new-account share and author concentration are treated as fake-engagement signals.
* External text (token names, descriptions, social posts) is data, never instructions, and is HTML-escaped in the dashboard.

## Operational

* Runs as non-root in Docker; memory limited; restart policies; healthchecks on `/api/health`.
* Rate limiters per provider protect against bans; DOWN providers are cooled off for 60 s.
* Audit log records every analysis, alert, paper trade and user action.
