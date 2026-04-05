# Chunk 07: Integration Wiring, Docker Compose, and Benchmark Harness

**Status:** Planned
**Depends on:** Chunk 06
**PRD References:** FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, AC-01 through AC-14, EC-04, EC-12 (DEPLOYMENT.md stub)

---

## What This Chunk Delivers

After this chunk is merged the repository is a fully operational, end-to-end production-grade base. `src/app.ts` registers every plugin in the correct order. `src/index.ts` starts the server and handles process signals. `docker-compose.yml` and PgBouncer config bring up the full local dev stack. The `autocannon` benchmark harness validates the < 1 ms p99 middleware overhead budget. The graceful shutdown integration test (written in Chunk 02) now fully passes. All acceptance criteria from the PRD (AC-01 through AC-14) are satisfied. This is the chunk that makes the entire system runnable with `npm start` + `docker compose up`.

---

## Explicit Scope

### In Scope
- [ ] `src/app.ts` — exported `buildApp(config)` function; registers all plugins in the authoritative order from technical design §1.1:
  1. `loadConfig()` (already resolved; passed in)
  2. Pino logger via `createFastifyInstance(config, buildLogger(config))`
  3. `@fastify/close-with-grace` with teardown sequence (redis sync stop → redis teardown → postgres teardown → fastify.close())
  4. `latencyCircuitBreaker.start()` at app boot; `latencyCircuitBreaker.stop()` in teardown
  5. Security middleware (Helmet, CORS, body limit) — Chunk 03
  6. Correlation ID middleware — Chunk 03
  7. Tracing slot (no-op) — Chunk 03
  8. Rate limiting middleware — Chunk 05
  9. Validation middleware registration (factory available for per-route use) — Chunk 05
  10. `onResponse` hook for HTTP metrics recording (`httpRequestDurationMs`, `httpRequestsTotal`) — Chunk 04
  11. Global error handler (`fastify.setErrorHandler`) — formats `StandardErrorResponse`; 500 messages are generic
  12. Routes (`registerRoutes(fastify, { postgres, redis })`) — Chunk 06
  13. Returns Fastify instance
- [ ] `src/index.ts` — entry point; calls `loadConfig()`; initialises connectors (`postgres.connect()`, `redis.connect()`, `syncTask.start()` if hybrid); calls `buildApp(config)`; starts listening on `config.PORT`; starts metrics server on `config.METRICS_PORT`; never imported by tests
- [ ] `docker/docker-compose.yml` — Postgres 16-alpine + PgBouncer + Redis 7-alpine per technical design §12; healthchecks defined; application NOT a service (runs outside compose for dev)
- [ ] `docker/pgbouncer/pgbouncer.ini` — transaction pool mode; max_client_conn 200; default_pool_size 20 per technical design §12.3
- [ ] `docker/pgbouncer/userlist.txt` — md5-hashed credentials matching `POSTGRES_USER`/`POSTGRES_PASSWORD` from compose env (plaintext for local dev only; gitignored in production)
- [ ] `.env.example` — MODIFY: verify completeness against final implementation; add any vars discovered during implementation of Chunks 01–06
- [ ] `DEPLOYMENT.md` — stub document: documents read-replica slot (D-09), PgBouncer production setup, Redis Cluster/Sentinel setup, load balancer config; no implementation — stub only
- [ ] `tests/benchmarks/middleware-overhead.ts` — autocannon benchmark harness per technical design §13.4; bare Fastify baseline p99 vs full middleware stack p99; delta assertion ≤ 1 ms; exits with code 1 on failure; runs as `tsx tests/benchmarks/middleware-overhead.ts`
- [ ] `tests/integration/gracefulShutdown.test.ts` — COMPLETE: this file was stubbed in Chunk 02; now wire fully with `buildApp()` and verify SIGTERM drains in-flight, exit code 0, zero dropped requests, completes within `SHUTDOWN_GRACE_MS`
- [ ] `tests/integration/health.test.ts` — VERIFY: confirm the integration test written in Chunk 06 passes with the full `buildApp()` stack (not just the controller in isolation)
- [ ] `tests/integration/rateLimit.test.ts` — VERIFY: confirm the integration test written in Chunk 05 passes with the full `buildApp()` stack

### Out of Scope
- We are NOT implementing authentication middleware (out of v1 scope)
- We are NOT implementing OpenTelemetry tracing (tracing slot remains a no-op)
- We are NOT adding per-route rate limit overrides (future scope)
- We are NOT creating Kubernetes manifests or CI/CD pipelines
- We are NOT enforcing the ≥ 95% coverage gate here — that is Phase 8 (final system validation)

---

## Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `src/app.ts` | Create | buildApp(config); all plugins in strict order; global error handler |
| `src/index.ts` | Create | Entry point; connect/start/listen; never imported by tests |
| `docker/docker-compose.yml` | Create | Postgres + PgBouncer + Redis; healthchecks |
| `docker/pgbouncer/pgbouncer.ini` | Create | Transaction pool mode; connection limits per design §12.3 |
| `docker/pgbouncer/userlist.txt` | Create | md5 credentials; gitignored outside of local dev |
| `.env.example` | Modify | Final verification pass; add any missing vars |
| `DEPLOYMENT.md` | Create | Stub only; documents replica slot, PgBouncer, Redis Cluster, LB config |
| `tests/benchmarks/middleware-overhead.ts` | Create | autocannon; baseline vs full stack; delta ≤ 1 ms |
| `tests/integration/gracefulShutdown.test.ts` | Modify | Complete implementation; was stub from Chunk 02 |
| `tests/integration/health.test.ts` | Modify (verify) | Confirm passes with full buildApp() stack |
| `tests/integration/rateLimit.test.ts` | Modify (verify) | Confirm passes with full buildApp() stack |

---

## Data Model

```typescript
// src/app.ts public surface
export async function buildApp(config: Config): Promise<FastifyInstance>;

// src/index.ts — not exported
// Orchestrates: loadConfig → connectors.connect() → buildApp() → listen()

// Plugin registration order (authoritative):
// 1. createFastifyInstance (factory.ts)
// 2. close-with-grace
// 3. latencyCircuitBreaker.start()
// 4. security middleware
// 5. correlationId middleware
// 6. tracingSlot
// 7. rateLimit middleware
// 8. onResponse metrics hook
// 9. setErrorHandler (global)
// 10. registerRoutes
```

---

## API Contract

No new endpoints in this chunk. All endpoints defined in prior chunks are now fully wired together.

End-to-end flow verified:
- `GET /health` → all middleware layers → controller → response
- `GET /metrics` (metrics port) → real Prometheus output
- Any request body > `BODY_SIZE_LIMIT` → 413
- Rate limit exceeded → 429 + `Retry-After`
- SIGTERM → drain → clean exit

---

## Acceptance Criteria

- [ ] AC-C07-01: `npm start` (after `docker compose up`) starts the server, connects to Postgres and Redis, and `GET /health` returns 200
- [ ] AC-C07-02: `GET /health` returns the correct `HealthResponse` shape when all deps are up (maps to PRD AC-01)
- [ ] AC-C07-03: `GET /health` returns 503 when DB container is stopped (maps to PRD AC-02)
- [ ] AC-C07-04: `GET /health` returns 200 with `redis: degraded` when Redis container is stopped (maps to PRD AC-03)
- [ ] AC-C07-05: Request body > `BODY_SIZE_LIMIT` returns 413 with `PAYLOAD_TOO_LARGE` (maps to PRD AC-04)
- [ ] AC-C07-06: IP exceeding per-IP token bucket returns 429 with `Retry-After` (maps to PRD AC-05)
- [ ] AC-C07-07: Instance RPS exceeding global circuit breaker returns 429 (maps to PRD AC-06)
- [ ] AC-C07-08: IPs in `RATE_LIMIT_BYPASS_CIDRS` bypass both rate limit layers (maps to PRD AC-07)
- [ ] AC-C07-09: `RATE_LIMIT_DISABLED=true` disables all rate limiting (maps to PRD AC-08)
- [ ] AC-C07-10: All responses include Helmet security headers (maps to PRD AC-09)
- [ ] AC-C07-11: Every request log line contains `correlationId`; no `password`, `token`, `secret`, `authorization`, or `cookie` field appears in any log line (maps to PRD AC-10)
- [ ] AC-C07-12: `GET /metrics` returns valid Prometheus text format with `http_request_duration_ms` histogram (maps to PRD AC-11)
- [ ] AC-C07-13: Server exits cleanly on SIGTERM with zero in-flight requests dropped; shutdown completes within `SHUTDOWN_GRACE_MS` (maps to PRD AC-12)
- [ ] AC-C07-14: Missing required env vars at startup crash with a human-readable numbered list of missing vars (maps to PRD AC-13)
- [ ] AC-C07-15: Benchmark harness reports middleware overhead delta ≤ 1 ms p99 (maps to PRD AC-14); benchmark exits 0 on pass, exits 1 on fail
- [ ] AC-C07-16: `docker compose up` starts all three services (Postgres, PgBouncer, Redis) with healthchecks passing within 30 s
- [ ] AC-C07-17: All integration tests pass with the full `buildApp()` stack (`npm run test:integration`)

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Middleware overhead (p99 delta) | ≤ 1 ms vs bare Fastify baseline (AC-14, AC-C07-15) |
| Throughput on no-op route | ≥ 10k RPS per process on a single core (noted in benchmark; hard assertion is the 1 ms delta) |
| Graceful shutdown drain | ≤ `SHUTDOWN_GRACE_MS` (30 s default); ideally < 5 s when no long-lived requests |
| `docker compose up` healthchecks | All services healthy within 30 s |

---

## Security Requirements

- [ ] `src/index.ts` must not log the full `Config` object — individual non-sensitive fields (PORT, NODE_ENV) may be logged at startup; secret fields must not appear
- [ ] `DEPLOYMENT.md` stub must document that `docker/pgbouncer/userlist.txt` is gitignored in non-local environments and must be generated from a secrets manager in production
- [ ] Global error handler in `app.ts` must ensure 500-level errors never expose stack traces or internal error messages to the client
- [ ] Plugin registration order must place security middleware (Helmet, CORS, body limit) before rate limiting; this ensures security headers are set even on rejected (429) responses

---

## Error Scenarios to Handle

| Scenario | Expected Behaviour |
|----------|-------------------|
| DB unreachable at startup (EC-01) | `postgres.connect()` retries, then calls `process.exit(1)` — tested via unit test of the connector; not re-tested as full integration here (would require stopping Postgres before `buildApp()`) |
| SIGTERM during active requests (EC-04) | Drain within `SHUTDOWN_GRACE_MS`; exit 0; verified in gracefulShutdown integration test |
| Missing env vars (EC-05) | Crash fast with human-readable list; tested by starting the process with env vars stripped |
| Benchmark harness environment sensitivity | On a slow CI runner, the delta may exceed 1 ms due to runner load. The benchmark must print both values and a clear calibration warning before exiting 1. First-time failure should prompt calibration review per technical design §13.4. |

---

## Risk Flags

- [ ] Risk: Plugin registration order in `app.ts` is the most failure-prone part of this chunk. Incorrect order (e.g. rate limiting before correlation ID) means 429 responses lack a correlation ID. The `onResponse` metrics hook must be registered after routes so it captures route information. Validate the exact registration order against the data flow diagram in technical design §4.
- [ ] Risk: `@fastify/close-with-grace` must be registered before routes so it captures in-flight requests correctly. The graceful shutdown integration test must verify this by firing a SIGTERM while a slow request is in progress.
- [ ] Risk: The benchmark harness (`tests/benchmarks/middleware-overhead.ts`) runs `autocannon` as a child process. The `SCAFFOLD_DEPTH` guard from the memory file must be checked at the top of this script to prevent recursive spawning in CI environments where vitest may call it.
- [ ] Risk: `docker/pgbouncer/userlist.txt` contains credentials in md5 format for local dev. Must be added to `.gitignore` and documented clearly. A placeholder or generator script should be provided so new developers can create it without reading raw passwords from compose env vars manually.

---

## Definition of Done

- [ ] All acceptance criteria implemented
- [ ] All pre-written tests passing (unit and integration)
- [ ] Benchmark harness exits 0 (delta ≤ 1 ms) or failure is documented with calibration note
- [ ] ESLint zero issues
- [ ] TypeScript strict mode zero errors
- [ ] `docker compose up` verified locally
- [ ] Self-review checklist complete
- [ ] PR description written
- [ ] No TODO comments left in code
