# PRD: Production-Grade Node.js Base Repository

**Status:** FINALIZED
**Author:** (stakeholder + brainstorming)
**Date:** 2026-04-05
**Version:** 1.0

---

## 1. Problem Statement

Every new service spends its first sprint wiring the same boilerplate: server setup, database connectors, Redis, rate limiting, security headers, observability. This work is repetitive, inconsistently done, and often leaves gaps that bite teams in production.

This project delivers a **single, opinionated, production-ready base repository** that any engineer — including freshers — can clone and immediately start writing business logic. The base handles everything that is not business logic, and handles it correctly.

**Cost of not solving it:** each team reinvents the wheel, introduces security gaps, skips observability, and ships hard-to-maintain code.

---

## 2. Goals

- **G-01:** Provide a working Fastify server skeleton with all cross-cutting concerns pre-wired so the team writes zero boilerplate on new projects.
- **G-02:** Ensure **latency overhead from the base layer is minimal and measurable** — every middleware must justify its cost on the hot path. p99 added latency target: < 1 ms on a no-op route.
- **G-03:** Achieve **high-availability posture** through graceful shutdown, health checks, connection pooling, retry-safe connector design, and stateless multi-instance architecture.
- **G-04:** Code must be **readable and navigable by freshers** — clear module boundaries, no magic, self-documenting structure, inline comments on non-obvious paths.
- **G-05:** Security, rate limiting, and observability are **on by default** — not opt-in add-ons.

---

## 3. Non-Goals (v1 scope)

- No business logic — this is a base only; domain code is added on top.
- No authentication implementation — the base provides a middleware slot but not a specific auth strategy (JWT, mTLS, API key), which varies per project.
- No message queue / pub-sub connectors.
- No Kubernetes manifests or CI/CD pipelines.
- No strict global per-request rate limiting (would require Redis on the hot path, adding latency; approximate global enforcement via async sync is acceptable).

---

## 4. Technical Decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| HTTP framework | **Fastify** | Lowest overhead in Node.js HTTP space; JSON schema serialisation built-in; ~2× faster than Express on benchmarks |
| ORM | **Drizzle ORM** | No query engine runtime overhead (compiles to raw SQL); type-safe; SQL-close API readable by freshers; minimal magic |
| DB driver | **`pg` (node-postgres)** | Drizzle uses it under the hood; mature pool implementation |
| Redis client | **ioredis** | Stable, well-maintained, supports cluster mode |
| Logging | **Pino** (via Fastify's built-in logger) | Pino is the lowest-latency structured logger in Node.js; native to Fastify; Winston adds unnecessary overhead given Fastify ships Pino |
| Validation | **Zod** | Type inference + runtime validation; used for both route schemas and env config |
| Metrics | **prom-client** | De-facto Prometheus client; default Node.js metrics + custom histograms |
| Dev environment | **Docker Compose** with Postgres + PgBouncer + Redis | Local dev parity with production connection pooling topology |

---

## 5. Requirements

### 5.1 Functional Requirements

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| FR-01 | Fastify server starts, listens on configured port, handles graceful shutdown (SIGTERM/SIGINT) | P0 | |
| FR-02 | **PostgreSQL connector** — Drizzle ORM over `pg` pool; health check; graceful teardown | P0 | Pool sized via env vars |
| FR-03 | **Redis connector** — ioredis client; health check; graceful teardown; three operation modes | P0 | See §5.3 |
| FR-04 | **Security middleware** — `@fastify/helmet`, CORS allowlist, body size limit | P0 | |
| FR-05 | **Two-layer rate limiting** — per-IP token bucket (Layer 1) + global RPS circuit breaker (Layer 2) | P0 | See §5.4 |
| FR-06 | **Structured logging** — Pino JSON output, request/response log, correlation ID propagation, secret redaction | P0 | |
| FR-07 | **Metrics endpoint** `GET /metrics` — Prometheus format; RPS, latency histogram, error rate, pool gauges | P1 | |
| FR-08 | **Health endpoint** `GET /health` — DB + Redis liveness + server uptime; 200 / 503 | P0 | Sample API |
| FR-09 | **Input validation** — Zod schema middleware with standardised error response shape | P0 | |
| FR-10 | **Env config loader** — Zod-validated typed config; crash-fast with human-readable error on missing vars | P0 | |
| FR-11 | **Correlation ID** — UUID generated per request; `X-Correlation-Id` header in response; present in all log lines | P0 | |

### 5.2 Non-Functional Requirements

| Category | Requirement | Target |
|----------|-------------|--------|
| Latency | Added overhead of all base middleware on a no-op route | **< 1 ms p99** (micro-benchmark in CI) |
| Throughput | Base layer must not be the bottleneck | **≥ 10k RPS per process** on a single core |
| Availability | Graceful shutdown drains in-flight requests | ≤ 30 s drain; zero in-flight dropped |
| Availability | DB + Redis reconnect on transient failure | Exponential backoff + jitter; max retries configurable |
| Availability | Stateless design — no shared in-process state between requests | Required for multi-instance horizontal scale |
| Security | No secret material in logs | Pino `redact` paths enforced at logger level |
| Readability | Any junior engineer navigates a module without help | Max ~150 lines per file; explicit named exports; no implicit globals |

### 5.3 Redis Operation Modes

Configured via `REDIS_MODE` env var:

| Mode | Behaviour | Use case |
|------|-----------|----------|
| `local` (default) | No Redis calls — all state in-memory only | Dev / internal-only deployments |
| `hybrid` | In-memory fast path + **async background sync** to Redis every `REDIS_SYNC_INTERVAL_MS` (default 10 000 ms) | Multi-instance production; eventual global consistency |
| `redis-primary` | Every operation goes to Redis synchronously | Future non-rate-limit use cases (sessions, cache); **never used for rate limiting** |

**Rate limiting always uses `local` or `hybrid`** — `redis-primary` is reserved for other connectors where latency trade-off is acceptable.

**Memory safety for `local` / `hybrid` modes:**
- LRU Map capped at `RL_MAX_IPS` entries (default **500 000**, ~75 MB). Covers ~50× the per-instance active IP set at 1M system RPS.
- Background sweep every 60 s evicts entries whose TTL has expired.
- On LRU eviction in `hybrid` mode: Redis still holds the accurate global count; evicted IP gets a fresh local bucket (short leniency window) but global enforcement corrects on next sync.
- Acceptable data loss: rate limit counters may lose partial data on instance restart or Redis unavailability — this is explicitly accepted. No other data is stored in-memory with loss tolerance.

**On Redis unavailability in `hybrid` mode:**
- Sync task logs a warning and retries on the next interval.
- Rate limiting continues with local buckets — no request is dropped due to Redis being down.
- Health endpoint reports Redis as `degraded` (non-fatal).

### 5.4 Two-Layer Rate Limiting

```
Every request (hot path — zero I/O):
  Layer 1: Check global RPS circuit breaker (single atomic counter)
           → If instance RPS > RATE_LIMIT_GLOBAL_RPS_MAX → 429 immediately
  Layer 2: Check per-IP token bucket (LRU Map lookup)
           → If IP tokens exhausted → 429 with Retry-After header
           → Else decrement token, continue

Every REDIS_SYNC_INTERVAL_MS (background, non-blocking):
  → Batch INCRBY local deltas to Redis (pipeline, one round trip)
  → Read back global counts; adjust local bucket ceilings
```

**DDoS coverage:**
- Single-IP flood → Layer 2 per-IP bucket catches it per instance immediately.
- Distributed rotating-IP flood → Layer 1 global RPS circuit breaker catches it regardless of how many unique IPs are used.

**Internal microservice support:**
- `RATE_LIMIT_BYPASS_CIDRS`: comma-separated IP/CIDR list that skips both layers entirely (for internal mesh subnets).
- `RATE_LIMIT_DISABLED=true`: disables rate limiting globally (for fully internal-only deployments).

**Effective modes:** `disabled` | `ip-based` | `ip-based-with-bypass`

### 5.5 Multi-Instance Architecture

```
Internet / Load Balancer (AWS ALB / Nginx / similar)
    ↓  stateless round-robin — no sticky sessions
[Instance 1]  [Instance 2]  ...  [Instance N]
    ↓                                  ↓
PgBouncer (connection pooler)     Redis (Cluster / Sentinel)
    ↓
Postgres Primary + Read Replicas
```

**Per-instance sizing guidance (documented in repo):**
- Fastify process per CPU core (Node.js cluster or PM2 cluster mode).
- PG pool: `DB_POOL_MIN` / `DB_POOL_MAX` env vars. Recommended: 10–20 per process; PgBouncer absorbs into 20–50 real Postgres connections.
- Redis: 1 persistent ioredis connection per process; async-only for rate limit sync.
- At 1M system RPS with 10k RPS per instance: ~100 instances.

**Base repo responsibilities:**
- Stateless server (no shared in-process request state).
- Health endpoint returns readiness — load balancer stops routing to unhealthy instances.
- Graceful shutdown: stop accepting → drain in-flight → close pools → exit 0.
- Env-var-driven pool sizing so each deployment tunes without code changes.

**Infra not in base repo (documented in `DEPLOYMENT.md` stub):**
- PgBouncer deployment config.
- Redis Cluster / Sentinel setup.
- Load balancer configuration.

### 5.6 Health Endpoint Contract

```
GET /health

200 OK — all dependencies healthy
{
  "status": "ok",
  "uptime": 12345,
  "db": "connected",
  "redis": "connected" | "degraded",
  "timestamp": "2026-04-05T12:00:00.000Z"
}

503 Service Unavailable — DB unhealthy (Redis degraded does NOT trigger 503)
{
  "status": "degraded",
  "db": "disconnected",
  "redis": "connected" | "degraded",
  "timestamp": "..."
}
```

---

## 6. Module Structure

Follows an MCP-style layered architecture: **routes** only define paths, **controllers** handle request/response, **middleware** runs cross-cutting hooks, **helpers** provide domain-specific shared logic, **utils** provide pure stateless functions.

```
src/
  index.ts                        ← entry point; starts server; registers signals
  app.ts                          ← plugin registration order; exported for tests

  config/
    index.ts                      ← Zod-validated env loader; typed Config object

  server/
    factory.ts                    ← Fastify instance factory; base options
    metricsServer.ts              ← separate Fastify instance on METRICS_PORT

  connectors/                     ← infrastructure clients (DB + Redis)
    postgres/
      index.ts                    ← connect(); healthCheck(); teardown()
      pool.ts                     ← pg.Pool creation with env-driven sizing
      schema.ts                   ← Drizzle schema definitions (empty placeholder)
    redis/
      index.ts                    ← connect(); healthCheck(); teardown()
      factory.ts                  ← topology factory (standalone | cluster)
      standaloneClient.ts         ← ioredis.Redis wrapper
      clusterClient.ts            ← ioredis.Cluster wrapper
      syncTask.ts                 ← background hybrid sync task

  controllers/                    ← request/response logic; no direct DB calls
    health.controller.ts          ← calls connectors, formats health response

  routes/                         ← route registration only; no business logic
    health/
      index.ts                    ← registers GET /health → healthController
    index.ts                      ← registers all route groups on the Fastify instance

  middleware/                     ← Fastify hooks (onRequest / onSend)
    security/
      index.ts                    ← @fastify/helmet, @fastify/cors, body limit
    rateLimit/
      index.ts                    ← onRequest hook; layer orchestration; bypass check
      latencyCircuitBreaker.ts    ← Layer 1a: EMA baseline + ring buffer + state machine
      newIpLimiter.ts             ← Layer 1b: new unique IP/sec counter
      tokenBucket.ts              ← Layer 2: per-IP LRU token bucket
    validation/
      index.ts                    ← Zod schema wrapper; standard 400 error shape
    correlationId/
      index.ts                    ← UUID injection; X-Correlation-Id propagation

  observability/
    logger/
      index.ts                    ← Pino config; pino-pretty in dev; redact paths
    metrics/
      registry.ts                 ← prom-client registry; collectDefaultMetrics
      definitions.ts              ← named metric instances (histograms, counters, gauges)

  helpers/                        ← domain-specific shared logic (not tied to a single module)
    ipExtractor.ts                ← X-Forwarded-For parsing with TRUSTED_PROXY_DEPTH
    cidrMatcher.ts                ← bitwise CIDR/IP membership check
    lruMap.ts                     ← generic LRU Map implementation (used by token bucket)
    retry.ts                      ← exponential backoff + jitter (used by DB connector)

  utils/                          ← pure stateless utility functions
    uuid.ts                       ← UUID v4 generation
    time.ts                       ← time helpers: nowMs(), sleep()

  types/
    index.ts                      ← shared TypeScript interfaces; no runtime code

docker/
  docker-compose.yml              ← postgres + pgbouncer + redis
  pgbouncer/
    pgbouncer.ini                 ← transaction pool mode, connection limits
```

---

## 7. Edge Cases

| # | Scenario | Expected behaviour |
|---|----------|-------------------|
| EC-01 | DB unreachable at startup | Crash fast with clear error message; exit 1 |
| EC-02 | DB connection lost mid-run | Pool retries with backoff; `GET /health` returns 503; non-DB routes continue serving |
| EC-03 | Redis unreachable in `hybrid` mode | Sync task logs warning; rate limiting continues on local buckets; health reports `redis: degraded`; app keeps running |
| EC-04 | SIGTERM during active requests | Stop accepting connections; drain in-flight within 30 s; close DB + Redis; exit 0 |
| EC-05 | Missing required env var at startup | Crash with list of all missing vars; exit 1 |
| EC-06 | Request body exceeds size limit | 413 with standard error shape |
| EC-07 | Per-IP rate limit exceeded | 429 with `Retry-After` header |
| EC-08 | Global RPS circuit breaker triggered | 429 with `Retry-After` header |
| EC-09 | Invalid JSON body | 400 with Zod validation error in standard shape |
| EC-10 | Request from bypass CIDR | Rate limiting skipped entirely; request proceeds normally |
| EC-11 | `RATE_LIMIT_DISABLED=true` set | Both rate limit layers inactive; all requests pass through |

---

## 8. Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-01 | `GET /health` returns 200 with correct shape when DB + Redis are up |
| AC-02 | `GET /health` returns 503 when DB is unreachable |
| AC-03 | `GET /health` returns 200 with `redis: degraded` when Redis is unreachable (non-fatal) |
| AC-04 | Request body exceeding limit returns 413 |
| AC-05 | IP exceeding per-IP token bucket returns 429 with `Retry-After` |
| AC-06 | Instance RPS exceeding global circuit breaker returns 429 |
| AC-07 | IPs in `RATE_LIMIT_BYPASS_CIDRS` bypass both rate limit layers |
| AC-08 | `RATE_LIMIT_DISABLED=true` disables all rate limiting |
| AC-09 | All response headers include Helmet security headers |
| AC-10 | Every request log line contains correlation ID; no secret fields appear in logs |
| AC-11 | `GET /metrics` returns valid Prometheus text format with latency histogram |
| AC-12 | Server exits cleanly on SIGTERM with zero in-flight requests dropped |
| AC-13 | Missing required env vars at startup crash with a human-readable error listing all missing vars |
| AC-14 | p99 added latency of base middleware on a no-op route ≤ 1 ms (micro-benchmark in CI) |
| AC-15 | All tests pass; coverage ≥ 95% lines/branches/functions/statements (enforced in Phase 8) |

---

## 9. Security Considerations

- **Helmet (`@fastify/helmet`):** `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy` — on by default.
- **CORS:** strict allowlist from `CORS_ALLOWED_ORIGINS` env var; unknown origins rejected.
- **Body size:** `BODY_SIZE_LIMIT` env var (default `100kb`) enforced before parsing.
- **Rate limiting:** per-IP by default; bypass for trusted internal CIDRs via `RATE_LIMIT_BYPASS_CIDRS`.
- **Secret redaction:** Pino `redact` strips `password`, `token`, `secret`, `authorization`, `cookie` from all log output.
- **Env vars:** validated at startup; never logged; never included in any API response.

---

## 10. Observability

- **Structured logs (Pino):** JSON; fields per line: `timestamp`, `level`, `correlationId`, `reqId`, `method`, `url`, `statusCode`, `responseTime`, `msg`. Log level from `LOG_LEVEL` env var.
- **Metrics (prom-client):**
  - Default Node.js process metrics
  - `http_request_duration_ms` histogram — labels: `method`, `route`, `status_code`
  - `http_requests_total` counter
  - `db_pool_connections_active` gauge
  - `db_pool_connections_idle` gauge
  - `rate_limit_rejected_total` counter — labels: `layer` (`ip` | `global`)
  - `redis_sync_duration_ms` histogram
- **Correlation ID:** UUID v4 per request; `X-Correlation-Id` response header; present in every log line for that request lifecycle.
- **Tracing:** not in v1 — placeholder `tracingMiddleware` slot registered as no-op for future OpenTelemetry injection.

---

## 11. Dependencies

| Package | Purpose |
|---------|---------|
| `fastify` | HTTP server |
| `@fastify/helmet` | Security headers |
| `@fastify/cors` | CORS policy |
| `drizzle-orm` | ORM (zero runtime overhead) |
| `pg` | PostgreSQL driver (used by Drizzle) |
| `ioredis` | Redis client |
| `zod` | Input validation + env config schema |
| `prom-client` | Prometheus metrics |
| `uuid` | Correlation ID generation |
| `pino` | Structured logger (ships with Fastify) |

---

## 12. Future Scope

- OpenTelemetry distributed tracing (plug into the no-op tracing slot).
- Auth middleware implementations: JWT verifier, API key validator.
- Message queue connector (BullMQ / SQS).
- Kubernetes readiness/liveness probe alignment with `GET /health`.
- GitHub Actions CI pipeline template.
- Per-route rate limit overrides (currently one global policy).
- `redis-primary` mode usage for cache / session connectors.
