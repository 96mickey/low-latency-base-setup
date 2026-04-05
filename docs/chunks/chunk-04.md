# Chunk 04: Observability — Pino Logger Config and Prometheus Metrics Registry

**Status:** Planned
**Depends on:** Chunk 03
**PRD References:** FR-06, FR-07, AC-10, AC-11

---

## What This Chunk Delivers

After this chunk is merged the repository has a fully configured Pino logger (with dev/prod switching, secret redaction, and per-request child logger binding) and a named Prometheus metrics registry with all metric definitions and recording points. The `GET /metrics` route on the metrics server (stub from Chunk 02) is wired to return real Prometheus text output. Request duration histograms, request counters, DB pool gauges, rate limit counters, and Redis sync histograms are all defined and ready to be incremented by the middleware and connectors they trace. Log lines from this point forward will carry correlation IDs and respect secret redaction.

---

## Explicit Scope

### In Scope
- [ ] `src/observability/logger/index.ts` — `buildLogger(config)`: returns Pino options object; `pino-pretty` transport when `NODE_ENV=development`; raw JSON otherwise; `redact` paths: `password`, `token`, `secret`, `authorization`, `cookie`, `*.password`, `*.token`, `*.secret`; log level from `config.LOG_LEVEL`
- [ ] `src/observability/metrics/registry.ts` — singleton named `Registry`; calls `collectDefaultMetrics({ register: registry })`; exports `registry`
- [ ] `src/observability/metrics/definitions.ts` — defines and exports all named metric instances registered against the named registry:
  - `httpRequestDurationMs`: `Histogram` — labels `method`, `route`, `status_code`; buckets `[1, 5, 10, 25, 50, 100, 250, 500, 1000]`
  - `httpRequestsTotal`: `Counter` — labels `method`, `route`, `status_code`
  - `dbPoolConnectionsActive`: `Gauge`
  - `dbPoolConnectionsIdle`: `Gauge`
  - `rateLimitRejectedTotal`: `Counter` — label `layer` (`ip` | `global` | `new_ip`)
  - `redisSyncDurationMs`: `Histogram` — buckets `[5, 10, 25, 50, 100, 250, 500]`
  - `redisSyncErrorsTotal`: `Counter`
- [ ] `src/server/metricsServer.ts` — MODIFY: wire `GET /metrics` route to call `registry.metrics()` and return Prometheus text format with correct `Content-Type: text/plain; version=0.0.4; charset=utf-8`
- [ ] `onResponse` hook defined (to be registered in `app.ts` in Chunk 07) — exported from `src/observability/metrics/definitions.ts` or a separate hook file; records `httpRequestDurationMs` and `httpRequestsTotal` per request
- [ ] `src/connectors/redis/syncTask.ts` — MODIFY: wire `redisSyncDurationMs.observe()` and `redisSyncErrorsTotal.inc()` calls into the sync task (previously stubs/no-ops)
- [ ] Unit tests: logger config shape (dev vs prod), redact paths present, metrics definitions exportable without error, registry isolation between test runs
- [ ] Integration test: `GET /metrics` (metrics port) returns 200 with `Content-Type: text/plain` and body containing at least the default Node.js metric names

### Out of Scope
- We are NOT adding rate limiting middleware — that is Chunk 05; `rateLimitRejectedTotal` is defined here but only incremented in Chunk 05
- We are NOT adding the health route or its controller — that is Chunk 06; `dbPoolConnectionsActive` / `dbPoolConnectionsIdle` gauges are defined here but only read from in Chunk 06's `GET /metrics` handler
- We are NOT creating `src/app.ts` — the `onResponse` hook for metrics is exported from this chunk but registered in Chunk 07
- We are NOT creating Docker Compose files (Chunk 07)

---

## Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `src/observability/logger/index.ts` | Create | buildLogger(); pino-pretty dev / JSON prod; redact |
| `src/observability/metrics/registry.ts` | Create | Named Registry; collectDefaultMetrics |
| `src/observability/metrics/definitions.ts` | Create | All named metric instances |
| `src/server/metricsServer.ts` | Modify | Wire GET /metrics to registry.metrics() |
| `src/connectors/redis/syncTask.ts` | Modify | Add redisSyncDurationMs and redisSyncErrorsTotal calls |
| `tests/unit/observability/logger.test.ts` | Create | Pino config shape; redact paths; dev vs prod transport |
| `tests/unit/observability/metrics.test.ts` | Create | Registry non-null; metric definitions exportable; no duplicate registration |
| `tests/integration/metrics.test.ts` | Create | GET /metrics → 200 text/plain; default metric names present |

---

## Data Model

```typescript
// src/observability/metrics/definitions.ts exports
import { Histogram, Counter, Gauge } from 'prom-client';

export const httpRequestDurationMs: Histogram<'method' | 'route' | 'status_code'>;
export const httpRequestsTotal: Counter<'method' | 'route' | 'status_code'>;
export const dbPoolConnectionsActive: Gauge;
export const dbPoolConnectionsIdle: Gauge;
export const rateLimitRejectedTotal: Counter<'layer'>;
export const redisSyncDurationMs: Histogram;
export const redisSyncErrorsTotal: Counter;

// onResponse hook factory — exported for registration in app.ts
export function makeMetricsHook(): (
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void,
) => void;
```

---

## API Contract

`GET /metrics` (port `METRICS_PORT`, default 9090):

```
HTTP/1.1 200 OK
Content-Type: text/plain; version=0.0.4; charset=utf-8

# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds.
# TYPE process_cpu_user_seconds_total counter
process_cpu_user_seconds_total 0.123456
...
# HELP http_request_duration_ms Duration of HTTP requests in milliseconds
# TYPE http_request_duration_ms histogram
http_request_duration_ms_bucket{le="1",method="GET",route="/health",status_code="200"} 0
...
```

No authentication required. Metrics port is internal-only by network policy (D-11).

---

## Acceptance Criteria

- [ ] AC-C04-01: `buildLogger({ NODE_ENV: 'development', ... })` returns a Pino config object with `transport.target === 'pino-pretty'`
- [ ] AC-C04-02: `buildLogger({ NODE_ENV: 'production', ... })` returns a Pino config object with no `transport` field
- [ ] AC-C04-03: The Pino config returned by `buildLogger()` includes `redact` paths covering `password`, `token`, `secret`, `authorization`, `cookie`, and their nested equivalents (`*.password` etc.)
- [ ] AC-C04-04: `registry.metrics()` returns a non-empty string (default Node.js metrics are collected)
- [ ] AC-C04-05: `httpRequestDurationMs`, `httpRequestsTotal`, `rateLimitRejectedTotal`, `redisSyncDurationMs`, `redisSyncErrorsTotal`, `dbPoolConnectionsActive`, `dbPoolConnectionsIdle` are all exported from `definitions.ts` without error and are registered against the named registry (not the global default)
- [ ] AC-C04-06: `GET /metrics` (metrics port) returns HTTP 200 with `Content-Type: text/plain; version=0.0.4; charset=utf-8`
- [ ] AC-C04-07: `GET /metrics` response body contains at least `process_cpu_user_seconds_total` and `http_request_duration_ms` metric names
- [ ] AC-C04-08: Importing `registry.ts` in two separate test modules does not produce a "metric already registered" error (registry isolation enforced by named registry, not global)
- [ ] AC-C04-09: All unit and integration tests for this chunk pass

---

## Performance Targets

| Metric | Target |
|--------|--------|
| `registry.metrics()` serialization | Synchronous; called only on `/metrics` scrape (not on the hot path) |
| Histogram `observe()` call cost | In-memory only; < 1 µs per call — not latency-tested per chunk |
| Logger build | One-time at startup; not on the hot path |

---

## Security Requirements

- [ ] `GET /metrics` endpoint must not be registered on the application port (`PORT`) under any circumstances; it must exist only on `METRICS_PORT`
- [ ] The named registry must be used; not `register: defaultRegistry` (which would be shared globally and could leak metrics across test isolation boundaries)
- [ ] No metric label must include request body content or PII — label values are fixed strings (`method`, `route`, `status_code`, `layer`)

---

## Error Scenarios to Handle

| Scenario | Expected Behaviour |
|----------|-------------------|
| `registry.metrics()` called before any request has been processed | Returns default Node.js metrics; custom histograms appear with zero observations — this is correct |
| `redisSyncDurationMs.observe()` called when Redis sync errors | `redisSyncErrorsTotal.inc()` called; `redisSyncDurationMs.observe()` still records the (failed) duration |
| Duplicate metric registration (defensive) | Named registry prevents this; if called twice in tests, the second call must not throw — handle with try/catch and reuse the existing metric |

---

## Risk Flags

- [ ] Risk: `prom-client`'s `collectDefaultMetrics` must be called exactly once per registry instance. In test environments where `registry.ts` is imported multiple times, the named registry singleton must be module-scoped (not re-instantiated per import). Verify with a multi-import test case.
- [ ] Risk: `pino-pretty` is a dev dependency. It must not be required at runtime in production. The `buildLogger()` function must only reference `pino-pretty` inside the `transport` config object (which Pino loads lazily), not via a top-level `import`. Verify the production build does not fail when `pino-pretty` is absent.

---

## Definition of Done

- [ ] All acceptance criteria implemented
- [ ] All pre-written tests passing
- [ ] ESLint zero issues
- [ ] TypeScript strict mode zero errors
- [ ] Self-review checklist complete
- [ ] PR description written
- [ ] No TODO comments left in code
