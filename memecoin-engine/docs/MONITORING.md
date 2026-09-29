# MONITORING

## Health endpoint — `GET /api/health` (also `/health.html`)

```
providers[]   id, capability, status (OK|DEGRADED|DOWN|UNCONFIGURED), successes, failures, consecutiveFailures, avgLatencyMs, lastError
queue         PENDING / RUNNING / DONE / DEAD job counts
workers       loops[] (name, interval, runs, errors, lastRunAt, lastDurationMs, lastError), streams[] (pumpportal-ws running?), db (OK|DOWN)
dataLatencySec  seconds since the worker loop last ran
errorRate     provider failures / total provider calls
counters      tokens_total, tokens_monitored, tokens_rejected, tokens_new, tokens_archived, tier1..tier4, high_conviction, watchlist,
              alerts_24h, analyses, analysis_errors, snapshots, predictions, outcomes_resolved, risk_events, alerts,
              alerts_suppressed_cooldown, alerts_suppressed_rate, tokens_discovered, discovery_<source>, discovery_source_failures,
              paper_opened, paper_closed, jobs_retried, jobs_dead, category_<CATEGORY>
```
Health snapshots are stored every `monitor.health_interval_sec` in `health_snapshots` (7-day retention).

## Signals to watch

| Symptom | Where | Meaning / action |
|---|---|---|
| provider `DEGRADED`/`DOWN` | health, logs `DATA_SOURCE_DEGRADED` | endpoint/rate-limit problem; engine keeps running on other sources. Check `npm run check:sources`. |
| `dataLatencySec` > 600 | dashboard LIVE dot amber/red | workers stalled; check loop errors and DB. |
| `queue.DEAD` growing | health page | jobs failing after max attempts; inspect `lastError`, requeue. |
| `errorRate` > 0.3 | health | mostly rate limits; lower tier cadences in `config.yaml`. |
| `pumpportal-ws` not running | health | stream reconnects with backoff; polling discovery continues. |
| `alerts_suppressed_rate` high | counters | hourly cap reached; raise `alerts.max_per_hour` or tighten thresholds. |
| `analysis_errors` rising | counters + logs | look at `err` in logs (mint, provider). |

## Logs

pino JSON (`LOG_LEVEL=info|debug`), pretty in TTY. Secrets are redacted. Useful greps: `"discovery cycle"`, `"provider call failed"`,
`"analysis failed"`, `"alert delivery failed"`, `DATA_SOURCE_DEGRADED`.

## Audit trail

`audit_logs` answers: why an alert appeared (`alert:<TYPE>` with alertId + snapshotId), what the bot knew (`analyze` entries:
sources, degraded, dataQuality, flags, missingSignals, failed gates, thesis), what happened later (`outcomes`, `paper_close`).
`GET /api/audit?subject=solana:<mint>` or the token page.
