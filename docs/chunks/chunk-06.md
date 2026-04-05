# Chunk 06: Health Controller and Health Route

**Status:** Planned
**Depends on:** Chunk 05
**PRD References:** FR-08, AC-01, AC-02, AC-03, EC-02, EC-03

---

## What This Chunk Delivers

After this chunk is merged the server exposes a fully functional `GET /health` endpoint. The endpoint queries the PostgreSQL and Redis connectors concurrently, formats the result per the PRD §5.6 contract, returns 200 when DB is healthy (Redis degraded is non-fatal), and returns 503 when DB is unreachable. The DB pool gauges (`dbPoolConnectionsActive`, `dbPoolConnectionsIdle`) defined in Chunk 04 are now populated on each `/metrics` scrape by reading the live pool state. The route registration index is also created, ready for future route namespaces.

---

## Explicit Scope

### In Scope
- [ ] `src/controllers/health.controller.ts` — `GET /health` handler; calls `postgres.healthCheck()` + `redis.healthCheck()` with `Promise.allSettled`; builds `HealthResponse`; returns 200 if `db === 'connected'`; returns 503 if `db === 'disconnected'`; `redis: 'degraded'` never triggers 503; injects connector instances — no direct infrastructure imports
- [ ] `src/routes/health/index.ts` — registers `GET /health` route on the Fastify instance; sets route schema (Fastify JSON schema for response serialisation); points to `healthController`; zero logic
- [ ] `src/routes/index.ts` — registers all route groups (currently just `health`); single place for future route namespaces
- [ ] `src/server/metricsServer.ts` — MODIFY: `GET /metrics` handler updated to read `db_pool_connections_active` / `db_pool_connections_idle` gauges from the live pool on each scrape (the pool reference is passed in at startup from the postgres connector)
- [ ] Unit tests: `healthController` with mocked connectors (all combinations: db up/redis up; db up/redis degraded; db down/redis up; db down/redis down); response shape validation; status code logic
- [ ] Integration tests: `GET /health` with real Testcontainers Postgres + Redis (200 all up; 503 DB stopped; 200 Redis stopped with `redis: degraded`)

### Out of Scope
- We are NOT creating `src/app.ts` or `src/index.ts` — full plugin registration wiring is Chunk 07
- We are NOT creating Docker Compose files — that is Chunk 07
- We are NOT adding additional routes beyond `/health` — business domain routes are added by consumer teams on top of this base repo
- We are NOT adding per-route validation in this chunk — `GET /health` has no request body or query parameters to validate

---

## Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `src/controllers/health.controller.ts` | Create | Promise.allSettled; HealthResponse; 200/503 logic |
| `src/routes/health/index.ts` | Create | Route registration; response schema |
| `src/routes/index.ts` | Create | Aggregated route registration index |
| `src/server/metricsServer.ts` | Modify | Pass pool reference for db gauge population |
| `tests/unit/controllers/health.test.ts` | Create | Mocked connectors; all health state combinations |
| `tests/integration/health.test.ts` | Create | Testcontainers; 200 all up; 503 db down; 200 redis down |

---

## Data Model

```typescript
// HealthResponse (defined in src/types/index.ts — Chunk 01)
interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;       // process.uptime() in seconds
  db: 'connected' | 'disconnected';
  redis: 'connected' | 'degraded';
  timestamp: string;    // ISO 8601
}

// healthController dependency injection interface
interface HealthControllerDeps {
  postgres: Pick<PostgresConnector, 'healthCheck'>;
  redis: Pick<RedisConnector, 'healthCheck'>;
}

// Route schema (Fastify JSON Schema — for response serialisation)
// 200 and 503 shapes are both HealthResponse
```

---

## API Contract

```
GET /health HTTP/1.1

Response 200 — DB connected, Redis connected:
{
  "status": "ok",
  "uptime": 12345,
  "db": "connected",
  "redis": "connected",
  "timestamp": "2026-04-06T10:00:00.000Z"
}

Response 200 — DB connected, Redis degraded (non-fatal):
{
  "status": "ok",
  "uptime": 12345,
  "db": "connected",
  "redis": "degraded",
  "timestamp": "2026-04-06T10:00:00.000Z"
}

Response 503 — DB disconnected:
{
  "status": "degraded",
  "uptime": 12345,
  "db": "disconnected",
  "redis": "connected",
  "timestamp": "2026-04-06T10:00:00.000Z"
}

Response headers (all responses):
  Content-Type: application/json
  X-Correlation-Id: <uuid-v4>
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Strict-Transport-Security: max-age=15552000; includeSubDomains
  (+ Helmet defaults)
```

Status code determination:
- `db === 'connected'` → HTTP 200 (regardless of redis state)
- `db === 'disconnected'` → HTTP 503

---

## Acceptance Criteria

- [ ] AC-C06-01: `GET /health` returns 200 with `{ status: 'ok', db: 'connected', redis: 'connected' }` when both connectors are healthy
- [ ] AC-C06-02: `GET /health` returns 503 with `{ status: 'degraded', db: 'disconnected' }` when the DB is unreachable (Testcontainers Postgres stopped)
- [ ] AC-C06-03: `GET /health` returns 200 with `{ status: 'ok', redis: 'degraded' }` when Redis is unreachable (Testcontainers Redis stopped) — non-fatal
- [ ] AC-C06-04: `GET /health` response always includes `uptime` (positive number) and `timestamp` (valid ISO 8601 string)
- [ ] AC-C06-05: `GET /health` response always includes `X-Correlation-Id` response header
- [ ] AC-C06-06: `GET /health` response always includes Helmet security headers (`X-Content-Type-Options`, etc.)
- [ ] AC-C06-07: The `healthController` calls both `postgres.healthCheck()` and `redis.healthCheck()` concurrently (via `Promise.allSettled`), not sequentially — verified by measuring that combined call time ≈ max(individual times), not sum
- [ ] AC-C06-08: `dbPoolConnectionsActive` and `dbPoolConnectionsIdle` gauges reflect non-zero values in `GET /metrics` output after at least one DB health check has been performed
- [ ] AC-C06-09: All unit and integration tests for this chunk pass

---

## Performance Targets

| Metric | Target |
|--------|--------|
| `GET /health` when both deps healthy | p99 < 10 ms (health check I/O-bound; not a hot-path route) |
| `Promise.allSettled` for both checks | Parallel — overall time ≈ max(db check, redis check) |
| DB pool gauge population | Point-in-time read on `/metrics` scrape — not on the `/health` hot path |

---

## Security Requirements

- [ ] The `/health` response must never include stack traces, internal error messages, or connection string details even when DB/Redis is unreachable
- [ ] `/health` is subject to the full rate limiting stack (it is a valid DDoS probe target per technical design §3.1)
- [ ] The `503` response body must follow `HealthResponse` shape — not `StandardErrorResponse` — per the explicit contract in technical design §11.2

---

## Error Scenarios to Handle

| Scenario | Expected Behaviour |
|----------|-------------------|
| DB unreachable during health check (EC-02) | `postgres.healthCheck()` returns `'disconnected'` (does not throw); controller sets `db: 'disconnected'`; returns 503 |
| Redis unreachable in hybrid mode (EC-03) | `redis.healthCheck()` returns `'degraded'` (does not throw); controller sets `redis: 'degraded'`; returns 200 |
| Both DB and Redis unreachable | 503 (DB drives the status code); `redis: 'degraded'` in body |
| `postgres.healthCheck()` throws unexpectedly | `Promise.allSettled` catches it; controller treats it as `'disconnected'`; returns 503 |
| `redis.healthCheck()` throws unexpectedly | `Promise.allSettled` catches it; controller treats it as `'degraded'`; returns 200 |

---

## Risk Flags

- [ ] Risk: The `healthController` must inject connector dependencies rather than importing them directly. This is required for unit testability (mock injection). The route registration in `src/routes/health/index.ts` must pass connector instances from the app context — verify this pattern does not introduce tight coupling before Chunk 07 wires `app.ts`.
- [ ] Risk: `process.uptime()` returns seconds as a float. Confirm whether the PRD intends whole seconds or fractional. The technical design says `uptime: number` (seconds). Use `Math.floor(process.uptime())` for consistency. Flag if stakeholder wants milliseconds precision.

---

## Definition of Done

- [ ] All acceptance criteria implemented
- [ ] All pre-written tests passing
- [ ] ESLint zero issues
- [ ] TypeScript strict mode zero errors
- [ ] Self-review checklist complete
- [ ] PR description written
- [ ] No TODO comments left in code
