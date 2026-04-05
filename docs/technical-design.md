# Technical Design: Production-Grade Node.js Base Repository

**Status:** DRAFT — awaiting "Design approved"
**Phase:** 3 — Technical Design
**Date:** 2026-04-06
**Version:** 1.0
**Traces to:** `docs/prd/final-prd.md` v1.0, `docs/decisions.md` D-01 through D-17

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Module Breakdown](#2-module-breakdown)
3. [API Contracts](#3-api-contracts)
4. [Data Flow](#4-data-flow)
5. [Rate Limiting State Machine](#5-rate-limiting-state-machine)
6. [Redis Connector Design](#6-redis-connector-design)
7. [PostgreSQL Connector Design](#7-postgresql-connector-design)
8. [Graceful Shutdown Sequence](#8-graceful-shutdown-sequence)
9. [Observability Design](#9-observability-design)
10. [Configuration Schema](#10-configuration-schema)
11. [Error Handling Contract](#11-error-handling-contract)
12. [Docker Compose Topology](#12-docker-compose-topology)
13. [Test Architecture](#13-test-architecture)

---

## 1. Architecture Overview

### 1.1 Logical Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  External Traffic / Load Balancer                                            │
│  (AWS ALB / Nginx — not part of base repo; see DEPLOYMENT.md)                │
└──────────────────────┬───────────────────────────────────────────────────────┘
                       │  HTTP (port $PORT, default 3000)
                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Fastify Process (Node.js 20+)                                               │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Plugin Registration Order (app.ts)                                  │   │
│  │                                                                      │   │
│  │  1. Config (Zod-validated env)                                       │   │
│  │  2. Pino logger (via Fastify built-in)                               │   │
│  │  3. @fastify/close-with-grace (shutdown hook)                        │   │
│  │  4. Security middleware (@fastify/helmet, @fastify/cors, bodyLimit)  │   │
│  │  5. Correlation ID middleware                                         │   │
│  │  6. Tracing middleware slot (no-op in v1)                            │   │
│  │  7. Rate limiting (Layer 1a CB → Layer 1b new-IP → Layer 2 bucket)  │   │
│  │  8. Validation wrapper (Zod)                                         │   │
│  │  9. Routes (GET /health)                                             │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌────────────────────┐   ┌────────────────────────────────┐               │
│  │ Metrics Server     │   │ Connectors                     │               │
│  │ (port $METRICS_PORT│   │                                │               │
│  │  default 9090)     │   │  ┌──────────────────────────┐ │               │
│  │                    │   │  │ PostgreSQL Connector      │ │               │
│  │  GET /metrics      │   │  │ (Drizzle + pg pool)       │ │               │
│  │  prom-client       │   │  └──────────────────────────┘ │               │
│  │  Prometheus format │   │                                │               │
│  └────────────────────┘   │  ┌──────────────────────────┐ │               │
│                            │  │ Redis Connector          │ │               │
│                            │  │ (ioredis, factory)       │ │               │
│                            │  │ Mode: local|hybrid|      │ │               │
│                            │  │        redis-primary     │ │               │
│                            │  └──────────────────────────┘ │               │
│                            └────────────────────────────────┘               │
└──────────────────────────────────────────────────────────────────────────────┘
          │ pg pool                              │ ioredis
          ▼                                      ▼
┌───────────────────┐                ┌───────────────────────┐
│  PgBouncer        │                │  Redis                │
│  (local: docker)  │                │  standalone | cluster │
│  (prod: external) │                │  (REDIS_TOPOLOGY)     │
└────────┬──────────┘                └───────────────────────┘
         │
         ▼
┌───────────────────┐
│  PostgreSQL       │
│  Primary          │
│  (read replica    │
│   slot: D-09,     │
│   future scope)   │
└───────────────────┘
```

### 1.2 Process Topology

One Node.js process per CPU core is the deployment recommendation (via Node.js cluster or PM2 cluster mode — outside base repo scope). Each process is stateless: no shared in-process state between requests. All coordination happens through PgBouncer/Postgres and Redis.

### 1.3 Key Design Constraints

| Constraint | Source | Design consequence |
|---|---|---|
| p99 added latency < 1 ms | PRD NFR, AC-14 | All hot-path middleware is pure in-memory; zero I/O on the critical path |
| Stateless per-instance | PRD §5.5 | No in-process request state; LRU Map is instance-local, not shared |
| Metrics on separate port | D-11 | Separate Fastify instance for `/metrics`; app port never exposes metrics |
| Redis vars optional when `REDIS_MODE=local` | D-16 | Config schema must not require Redis vars unconditionally |
| Topology switching is unsafe at runtime | D-06 | Factory selects ioredis client class at boot; no hot-swap |

---

## 2. Module Breakdown

Follows an MCP-style layered architecture:
- **`routes/`** — route registration only (path + method + schema + → controller). Zero logic.
- **`controllers/`** — request/response handling. Parses input, calls connectors, formats response. No raw SQL.
- **`middleware/`** — cross-cutting Fastify hooks (onRequest / onSend). Runs on every request.
- **`connectors/`** — infrastructure clients (Postgres + Redis). Lifecycle managed by `app.ts`.
- **`helpers/`** — domain-specific shared logic reused across multiple modules.
- **`utils/`** — pure stateless functions with no domain knowledge.
- **`observability/`** — logging and metrics infrastructure.

Max ~150 lines per file (PRD NFR). No implicit globals.

```
src/
├── index.ts
├── app.ts
├── config/
│   └── index.ts
├── server/
│   ├── factory.ts
│   └── metricsServer.ts
├── connectors/
│   ├── postgres/
│   │   ├── index.ts
│   │   ├── pool.ts
│   │   └── schema.ts
│   └── redis/
│       ├── index.ts
│       ├── factory.ts
│       ├── standaloneClient.ts
│       ├── clusterClient.ts
│       └── syncTask.ts
├── controllers/
│   └── health.controller.ts
├── routes/
│   ├── health/
│   │   └── index.ts
│   └── index.ts
├── middleware/
│   ├── security/
│   │   └── index.ts
│   ├── rateLimit/
│   │   ├── index.ts
│   │   ├── latencyCircuitBreaker.ts
│   │   ├── newIpLimiter.ts
│   │   └── tokenBucket.ts
│   ├── validation/
│   │   └── index.ts
│   └── correlationId/
│       └── index.ts
├── observability/
│   ├── logger/
│   │   └── index.ts
│   └── metrics/
│       ├── registry.ts
│       └── definitions.ts
├── helpers/
│   ├── ipExtractor.ts
│   ├── cidrMatcher.ts
│   ├── lruMap.ts
│   └── retry.ts
├── utils/
│   ├── uuid.ts
│   └── time.ts
└── types/
    └── index.ts
```

### 2.1 File Responsibilities

| File | Responsibility |
|---|---|
| `src/index.ts` | Entry point. Calls `buildApp()`, starts listening on `$PORT`, registers SIGTERM/SIGINT/SIGUSR2 handlers. Never imported by tests. |
| `src/app.ts` | Exported `buildApp(config)`. Registers plugins, middleware, routes in strict order. Returns Fastify instance. Imported by tests. |
| `src/config/index.ts` | Zod schema for all 38 env vars. `loadConfig()` parses `process.env`, collects all errors, throws with a human-readable list if any are missing/invalid. Returns typed `Config` object. |
| `src/server/factory.ts` | `createFastifyInstance(config, logger)` — constructs Fastify with logger and base options. Separated from `app.ts` to allow unit tests to swap the instance without full plugin registration. |
| `src/server/metricsServer.ts` | Standalone Fastify instance on `METRICS_PORT`. Single `GET /metrics` route returning prom-client registry output. Lifecycle called from `index.ts`. |
| `src/connectors/postgres/index.ts` | Public interface: `connect()`, `healthCheck()`, `teardown()`. Orchestrates pool init and startup retry logic (D-08). |
| `src/connectors/postgres/pool.ts` | Creates `pg.Pool` with env-driven sizing (`DB_POOL_MIN`, `DB_POOL_MAX`). Exports pool for Drizzle. |
| `src/connectors/postgres/schema.ts` | Drizzle schema definitions. Empty placeholder in base repo — consumer teams add tables here. |
| `src/connectors/redis/index.ts` | Public interface: `connect()`, `healthCheck()`, `teardown()`. Delegates to factory; exposes active client. |
| `src/connectors/redis/factory.ts` | Reads `REDIS_TOPOLOGY` + `REDIS_MODE` at boot. Returns `standaloneClient`, `clusterClient`, or no-op stub (when `REDIS_MODE=local`). All three satisfy the same `RedisClientInterface`. |
| `src/connectors/redis/standaloneClient.ts` | Wraps `new ioredis.Redis(...)`. Configures retry strategy via `helpers/retry.ts`. |
| `src/connectors/redis/clusterClient.ts` | Wraps `new ioredis.Cluster([...])`. Reads `REDIS_CLUSTER_NODES` (JSON array of `{host, port}`). Same interface as standalone. |
| `src/connectors/redis/syncTask.ts` | Background interval task. Runs every `REDIS_SYNC_INTERVAL_MS`. Batch-pipelines rate limit deltas to Redis via `INCRBY`, reads back global counts, adjusts local bucket ceilings. Active only in `hybrid` mode. |
| `src/controllers/health.controller.ts` | `GET /health` handler. Calls `postgres.healthCheck()` + `redis.healthCheck()` concurrently. Formats and returns the health response per PRD §5.6. Injected with connector instances — no direct imports of infrastructure. |
| `src/routes/health/index.ts` | Registers `GET /health` route on the Fastify instance. Sets route schema. Points to `healthController`. No logic. |
| `src/routes/index.ts` | Registers all route groups (`health`, and future additions) on the Fastify instance. Single place to add new route namespaces. |
| `src/middleware/security/index.ts` | Registers `@fastify/helmet`, `@fastify/cors` (CORS_ALLOWED_ORIGINS allowlist), body-size limit (`BODY_SIZE_LIMIT`). |
| `src/middleware/rateLimit/index.ts` | `onRequest` hook. Reads client IP via `helpers/ipExtractor`. Checks bypass CIDR list via `helpers/cidrMatcher`. Runs Layer 1a → Layer 1b → Layer 2 in order. Returns 429 at first failed layer. |
| `src/middleware/rateLimit/latencyCircuitBreaker.ts` | Layer 1a. Ring buffer of recent request durations (`LATENCY_CB_WINDOW_SIZE`). EMA baseline + p99. Background interval drives CLOSED → OPEN → HALF-OPEN → CLOSED state machine. Warmup suppresses early trips. |
| `src/middleware/rateLimit/newIpLimiter.ts` | Layer 1b. Sliding-window counter of new unique IPs/sec. Caps at `RL_NEW_IP_RATE_MAX`. Returning IPs (already in LRU) bypass entirely. |
| `src/middleware/rateLimit/tokenBucket.ts` | Layer 2. Per-IP token bucket backed by `helpers/lruMap`. Burst capacity `RL_IP_MAX_TOKENS`. Refill rate `RL_IP_REFILL_RATE` tokens/sec (lazy refill on access). Background sweep evicts expired entries every 60 s. |
| `src/middleware/validation/index.ts` | Zod schema compiler wrapper for Fastify. Converts Zod → JSON Schema. On failure, formats error into `StandardErrorResponse` and replies 400. |
| `src/middleware/correlationId/index.ts` | `onRequest`: reads `X-Correlation-Id` header or generates UUID via `utils/uuid`. Binds to Pino child logger. `onSend`: adds header to response. |
| `src/observability/logger/index.ts` | `buildLogger(config)` — Pino options. `pino-pretty` transport when `NODE_ENV=development`; raw JSON otherwise. Redact paths: `password`, `token`, `secret`, `authorization`, `cookie` (and nested). |
| `src/observability/metrics/registry.ts` | Singleton prom-client Registry. Enables `collectDefaultMetrics`. Exported to metrics server and middleware. |
| `src/observability/metrics/definitions.ts` | Named metric instances: histograms, counters, gauges. Imported by middleware and connectors that record observations. |
| `src/helpers/ipExtractor.ts` | Reads `X-Forwarded-For`, applies `TRUSTED_PROXY_DEPTH` offset to resolve the true client IP. Falls back to `request.ip` if header absent. |
| `src/helpers/cidrMatcher.ts` | Bitwise CIDR/IP membership check. Pre-compiles CIDR list at startup. O(n) over the bypass list — typically tiny (2–5 entries). |
| `src/helpers/lruMap.ts` | Generic LRU Map implementation. `get()`, `set()`, `has()` with O(1) eviction when cap is reached. Used by token bucket and new-IP limiter. |
| `src/helpers/retry.ts` | `withRetry(fn, options)` — exponential backoff + jitter. Used by DB connector startup and Redis client reconnect strategy. |
| `src/utils/uuid.ts` | `generateUuid()` — UUID v4 via Node.js `crypto.randomUUID()`. No external dependency. |
| `src/utils/time.ts` | `nowMs()` — `Date.now()` alias for testability. `sleep(ms)` — promisified `setTimeout`. |
| `src/types/index.ts` | `Config`, `ConnectorInterface`, `RedisClientInterface`, `RateLimitBucketEntry`, `HealthResponse`, `StandardErrorResponse`, `RedisMode`, `RedisTopology`, `CircuitBreakerState`. No runtime code. |

---

## 3. API Contracts

### 3.1 Application Port Routes

Both routes are registered on the Fastify app instance (port `$PORT`, default 3000).

#### GET /health

**Purpose:** Liveness + dependency check for load balancer health probes.

**Request:**
```
GET /health HTTP/1.1
Host: service.example.com
```
No request body. No query parameters.

**Response 200 — all dependencies healthy:**
```json
{
  "status": "ok",
  "uptime": 12345,
  "db": "connected",
  "redis": "connected",
  "timestamp": "2026-04-06T10:00:00.000Z"
}
```

**Response 200 — Redis degraded (non-fatal):**
```json
{
  "status": "ok",
  "uptime": 12345,
  "db": "connected",
  "redis": "degraded",
  "timestamp": "2026-04-06T10:00:00.000Z"
}
```

**Response 503 — DB unhealthy:**
```json
{
  "status": "degraded",
  "uptime": 12345,
  "db": "disconnected",
  "redis": "connected",
  "timestamp": "2026-04-06T10:00:00.000Z"
}
```

**Response headers (all responses):**
```
Content-Type: application/json
X-Correlation-Id: <uuid-v4>
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Strict-Transport-Security: max-age=15552000; includeSubDomains
(+ other Helmet defaults)
```

**TypeScript shape:**
```typescript
interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;          // process.uptime() in seconds
  db: 'connected' | 'disconnected';
  redis: 'connected' | 'degraded';
  timestamp: string;       // ISO 8601
}
```

**Status code logic:**
- 200 if `db === 'connected'` (regardless of redis state)
- 503 if `db === 'disconnected'`

**Rate limiting:** `/health` is subject to all rate limiting layers (it is a valid probe target for DDoS). Bypass via `RATE_LIMIT_BYPASS_CIDRS` applies.

---

### 3.2 Metrics Port Routes

Served on a separate Fastify instance (port `$METRICS_PORT`, default 9090). This port must not be exposed to the public internet (D-11).

#### GET /metrics

**Purpose:** Prometheus scrape endpoint.

**Request:**
```
GET /metrics HTTP/1.1
Host: service.internal:9090
```

**Response 200:**
```
Content-Type: text/plain; version=0.0.4; charset=utf-8

# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds.
# TYPE process_cpu_user_seconds_total counter
process_cpu_user_seconds_total 0.123456
...
# HELP http_request_duration_ms Duration of HTTP requests in milliseconds
# TYPE http_request_duration_ms histogram
http_request_duration_ms_bucket{le="1",method="GET",route="/health",status_code="200"} 123
...
```

No authentication in v1. Rate limiting does not apply (metrics port is internal-only by network policy).

---

### 3.3 Error Responses — All Routes

All error responses from application routes (port `$PORT`) share a single shape regardless of error origin (rate limiting, validation, body size, internal error).

**Standard Error Shape:**
```typescript
interface StandardErrorResponse {
  error: {
    code: string;       // Machine-readable code, e.g. "RATE_LIMIT_EXCEEDED"
    message: string;    // Human-readable description
    statusCode: number; // Mirrors HTTP status
    correlationId: string; // UUID for log correlation
  };
}
```

**Example 429 (per-IP token bucket exhausted):**
```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests from this IP. Please retry after 10 seconds.",
    "statusCode": 429,
    "correlationId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**Response headers on 429:**
```
Retry-After: 10
X-Correlation-Id: 550e8400-e29b-41d4-a716-446655440000
```

**HTTP Status → Error Code mapping:**

| HTTP Status | `error.code` | Trigger |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod schema failure; body is invalid JSON |
| 413 | `PAYLOAD_TOO_LARGE` | Body exceeds `BODY_SIZE_LIMIT` |
| 429 | `RATE_LIMIT_EXCEEDED` | Layer 1a, 1b, or Layer 2 rejection |
| 500 | `INTERNAL_ERROR` | Unhandled exception; never leaks stack trace |
| 503 | `SERVICE_UNAVAILABLE` | DB unreachable (health endpoint only) |

---

## 4. Data Flow

The lifecycle of a single HTTP request from TCP accept to response is traced below. Each layer is identified with its source module.

```
  TCP SYN+ACK
       │
       ▼
┌─────────────────────────────────────────────────────────┐
│  Node.js HTTP Server (Fastify)                          │
│  src/server/factory.ts                                  │
│  → Parses HTTP request line + headers                   │
│  → Creates Request + Reply objects                      │
└───────────────────────┬─────────────────────────────────┘
                        │ onRequest hooks (in registration order)
                        ▼
┌─────────────────────────────────────────────────────────┐
│  [Hook 1] Correlation ID                                │
│  src/middleware/correlationId/index.ts                  │
│  → Read X-Correlation-Id header OR generate UUID v4     │
│  → Attach to request.correlationId                      │
│  → Bind to Pino child logger for this request           │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  [Hook 2] Tracing slot (no-op in v1)                    │
│  src/middleware/tracingSlot/index.ts                    │
│  → No-op; placeholder for OpenTelemetry (future scope)  │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  [Hook 3] Rate Limiting                                 │
│  src/middleware/rateLimit/index.ts                      │
│                                                         │
│  Step A: Extract client IP                              │
│    → src/middleware/rateLimit/ipExtractor.ts            │
│    → X-Forwarded-For[-TRUSTED_PROXY_DEPTH] or req.ip    │
│                                                         │
│  Step B: Check bypass CIDR list                         │
│    → If IP matches RATE_LIMIT_BYPASS_CIDRS → skip all   │
│    → If RATE_LIMIT_DISABLED=true → skip all             │
│                                                         │
│  Step C: Layer 1a — Latency Circuit Breaker             │
│    → src/middleware/rateLimit/latencyCircuitBreaker.ts  │
│    → If state=OPEN → reply 429 immediately (no I/O)     │
│    → If state=CLOSED|HALF-OPEN → continue               │
│                                                         │
│  Step D: Layer 1b — New-IP Rate Limiter                 │
│    → src/middleware/rateLimit/newIpLimiter.ts           │
│    → If IP is new AND new-IP rate exceeded → reply 429  │
│    → If IP is returning (in LRU Map) → bypass this layer│
│                                                         │
│  Step E: Layer 2 — Per-IP Token Bucket                  │
│    → src/middleware/rateLimit/tokenBucket.ts            │
│    → LRU Map lookup for IP                              │
│    → Lazy refill tokens since last access               │
│    → If tokens == 0 → reply 429 + Retry-After header    │
│    → Else decrement token, continue                     │
│                                                         │
│  All 429s → Standard error shape; record metric          │
└───────────────────────┬─────────────────────────────────┘
                        │ (request continues past rate limiting)
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Security Middleware (applied at plugin level)          │
│  src/middleware/security/index.ts                       │
│  → @fastify/helmet sets security response headers       │
│  → @fastify/cors validates Origin header                │
│  → Body size guard enforces BODY_SIZE_LIMIT             │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│  Route Handler                                          │
│  src/routes/health/index.ts (GET /health)               │
│  → Calls postgres.healthCheck() + redis.healthCheck()   │
│    in parallel (Promise.allSettled)                     │
│  → Computes status; builds HealthResponse               │
│  → reply.send(body)                                     │
└───────────────────────┬─────────────────────────────────┘
                        │ onSend hooks
                        ▼
┌─────────────────────────────────────────────────────────┐
│  [onSend Hook] Correlation ID header injection          │
│  src/middleware/correlationId/index.ts                  │
│  → reply.header('X-Correlation-Id', request.correlationId) │
└───────────────────────┬─────────────────────────────────┘
                        │ onResponse hooks
                        ▼
┌─────────────────────────────────────────────────────────┐
│  [onResponse Hook] Metrics recording                    │
│  src/observability/metrics/definitions.ts               │
│  → Record http_request_duration_ms (method, route,      │
│    status_code labels)                                  │
│  → Increment http_requests_total                        │
│                                                         │
│  [onResponse] Pino request log                          │
│  → Fastify built-in access log (req + res + responseTime│
│    + correlationId from child logger)                   │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
                   TCP FIN / Response sent
```

### 4.1 Background Data Flows (off the hot path)

```
Every REDIS_SYNC_INTERVAL_MS (default 10 000 ms):
  src/connectors/redis/syncTask.ts
  → Collect local rate limit deltas from tokenBucket.ts
  → Build Redis pipeline: INCRBY <ip-key> <delta> EX <ttl>
  → Execute pipeline (one round trip to Redis)
  → Read back updated global counts
  → Adjust local bucket ceilings
  → Log sync duration to redis_sync_duration_ms histogram
  → On Redis error: log warning, skip sync cycle, retry next interval

Every 60 s:
  src/middleware/rateLimit/tokenBucket.ts (background sweep)
  → Iterate LRU Map, evict entries where last_access + TTL < now

Every LATENCY_CB_CHECK_INTERVAL_MS (default 100 ms):
  src/middleware/rateLimit/latencyCircuitBreaker.ts
  → Compute p99 from ring buffer
  → Compare to EMA baseline
  → Drive state machine transition
```

---

## 5. Rate Limiting State Machine

Decision trace: D-04, D-07, D-14.

### 5.1 Three-Layer Overview

```
Request arrives
     │
     ├─ RATE_LIMIT_DISABLED=true ──────────────────────────► PASS
     │
     ├─ IP in RATE_LIMIT_BYPASS_CIDRS ────────────────────► PASS
     │
     ▼
[Layer 1a] Latency Circuit Breaker
     │
     ├─ State = OPEN ──────────────────────────────────────► 429
     │
     ▼
[Layer 1b] New-IP Rate Limiter
     │
     ├─ IP is new AND new-IP rate exceeded ───────────────► 429
     │
     ▼
[Layer 2] Per-IP Token Bucket
     │
     ├─ Tokens = 0 ────────────────────────────────────────► 429 + Retry-After
     │
     └─ Tokens > 0 (decrement) ───────────────────────────► PASS
```

### 5.2 Layer 1a — Latency Circuit Breaker State Machine

```
States: CLOSED | OPEN | HALF_OPEN

             latency spike detected
CLOSED ──────────────────────────────────────► OPEN
  ▲                                              │
  │  recovery probe succeeds                     │ LATENCY_CB_RECOVERY_MS elapses
  │                                              ▼
HALF_OPEN ◄─────────────────────────────── HALF_OPEN
  │
  └─ recovery probe fails ────────────────────► OPEN
```

**State behaviours:**

| State | Behaviour on incoming request |
|---|---|
| `CLOSED` | Allow through; record latency to ring buffer |
| `OPEN` | Reject immediately with 429; no further processing |
| `HALF_OPEN` | Allow one probe request through; observe result |

**Transition triggers:**

| Transition | Condition |
|---|---|
| `CLOSED → OPEN` | p99 > (EMA_baseline + `LATENCY_CB_DELTA_MS`) AND warmup period elapsed |
| `OPEN → HALF_OPEN` | `LATENCY_CB_RECOVERY_MS` has elapsed since entering OPEN |
| `HALF_OPEN → CLOSED` | Probe request latency within acceptable range |
| `HALF_OPEN → OPEN` | Probe request latency still exceeds threshold |

**Environment variables (D-14):**

| Var | Type | Default | Description |
|---|---|---|---|
| `LATENCY_CB_DELTA_MS` | number | `5` | ms above EMA baseline that opens the circuit |
| `LATENCY_CB_WINDOW_SIZE` | number | `10000` | Ring buffer size (number of recent requests tracked) |
| `LATENCY_CB_CHECK_INTERVAL_MS` | number | `100` | Background recompute interval in ms |
| `LATENCY_CB_RECOVERY_MS` | number | `5000` | Time in OPEN state before transitioning to HALF_OPEN |
| `LATENCY_CB_WARMUP_MS` | number | `30000` | Warmup period ms; no trips during warmup; baseline seeded |

**Baseline seeding:** During `LATENCY_CB_WARMUP_MS`, all requests are allowed through. The EMA baseline is computed from real traffic. After warmup, p99 deltas are measured against this baseline.

**EMA formula:** `baseline = alpha * latest_p99 + (1 - alpha) * previous_baseline` where `alpha = 0.1` (slow-moving average; resistant to spikes). Alpha is not configurable in v1.

### 5.3 Layer 1b — New-IP Rate Limiter

**Purpose:** Detect rotating-IP DDoS without penalising legitimate returning users.

**Mechanism:**
- A sliding window counter tracks unique new IPs seen in the last second.
- "New IP" = IP not currently present in the Layer 2 LRU Map.
- If unique new IPs/sec > `RL_NEW_IP_RATE_MAX`, all subsequent new IPs in that window are rejected with 429.
- Returning IPs (already in LRU Map) bypass this layer entirely.

**Environment variables:**

| Var | Type | Default | Description |
|---|---|---|---|
| `RL_NEW_IP_RATE_MAX` | number | `1000` | Max new unique IPs per second before this layer trips |

### 5.4 Layer 2 — Per-IP Token Bucket

**Mechanism:** Lazy token refill. On each request for a given IP:
1. Compute elapsed time since last access.
2. Add `elapsed_seconds * RL_IP_REFILL_RATE` tokens (capped at `RL_IP_MAX_TOKENS`).
3. If tokens >= 1: decrement and allow.
4. If tokens < 1: reject with 429 and compute `Retry-After` = `ceil(1 / RL_IP_REFILL_RATE)`.

**LRU Map eviction:** When map size reaches `RL_MAX_IPS`, the least-recently-used entry is evicted. In `hybrid` mode, Redis holds the durable count; evicted IP gets a fresh local bucket on next arrival (short leniency window).

**Environment variables:**

| Var | Type | Default | Description |
|---|---|---|---|
| `RL_IP_MAX_TOKENS` | number | `100` | Burst capacity per IP |
| `RL_IP_REFILL_RATE` | number | `10` | Tokens refilled per second per IP |
| `RL_MAX_IPS` | number | `500000` | LRU Map cap (~75 MB at full capacity) |

### 5.5 Bypass and Disable

**CIDR bypass (`RATE_LIMIT_BYPASS_CIDRS`):**
- Comma-separated list of IPs or CIDR blocks (e.g. `10.0.0.0/8,172.16.0.0/12`).
- Evaluated before all three layers using a prefix-trie or `cidr` library.
- Matching IPs skip all layers entirely; proceed directly to route handler.

**Global disable (`RATE_LIMIT_DISABLED=true`):**
- All rate limiting middleware is registered but becomes a passthrough no-op.
- Metrics for rate limit rejections remain at zero.

---

## 6. Redis Connector Design

Decision trace: D-05, D-06.

### 6.1 Interface

All three client types (standalone, cluster, local stub) satisfy the same TypeScript interface:

```typescript
interface RedisConnector {
  connect(): Promise<void>;
  healthCheck(): Promise<'connected' | 'degraded'>;
  teardown(): Promise<void>;
  // Internal: used only by syncTask.ts
  pipeline(): RedisPipeline;
  get(key: string): Promise<string | null>;
}
```

`syncTask.ts` imports `RedisConnector` directly — it does not care about topology.

### 6.2 Factory Pattern

```
src/connectors/redis/factory.ts

createRedisConnector(config: Config): RedisConnector
  │
  ├─ REDIS_MODE=local ──────────► LocalStub (in-memory no-op; healthCheck always 'connected')
  │
  ├─ REDIS_TOPOLOGY=standalone ─► standaloneClient.ts (new ioredis.Redis)
  │
  └─ REDIS_TOPOLOGY=cluster ───► clusterClient.ts (new ioredis.Cluster)
```

**Mode switching is via env var + rolling restart only** (D-06). No runtime hot-swap.

### 6.3 Standalone Client

```typescript
// src/connectors/redis/standaloneClient.ts
new Redis({
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,   // optional
  db: config.REDIS_DB ?? 0,
  retryStrategy: (times: number) => Math.min(times * 200, 5000), // exponential backoff, cap 5 s
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,   // connect() called explicitly at startup
})
```

**`healthCheck()`:** Issues `PING` command; returns `'connected'` on success, `'degraded'` on error.

### 6.4 Cluster Client

```typescript
// src/connectors/redis/clusterClient.ts
new Cluster(
  config.REDIS_CLUSTER_NODES,  // parsed from REDIS_CLUSTER_NODES env var (JSON array)
  {
    redisOptions: {
      password: config.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
    },
    clusterRetryStrategy: (times: number) => Math.min(times * 200, 5000),
  }
)
```

**`REDIS_CLUSTER_NODES` format:** JSON string array: `[{"host":"redis-1","port":6379},{"host":"redis-2","port":6380}]`

### 6.5 Sync Task Design

File: `src/connectors/redis/syncTask.ts`

```
Startup (called from app.ts when REDIS_MODE=hybrid):
  → Create setInterval with REDIS_SYNC_INTERVAL_MS

Each interval tick:
  1. Call tokenBucket.drainDeltas() → Map<ip, deltaCount>
  2. If deltas is empty → skip
  3. Build Redis pipeline:
       for each [ip, delta] in deltas:
         pipeline.incrby(`rl:ip:${ip}`, delta)
         pipeline.expire(`rl:ip:${ip}`, RL_BUCKET_TTL_S)
  4. pipeline.exec()
  5. For each result:
       → Update tokenBucket ceiling for that IP
  6. Record sync duration to redis_sync_duration_ms histogram
  7. On any Redis error:
       → Log warning (includes correlationId: 'background-sync')
       → Increment redis_sync_errors_total counter
       → Continue; retry on next interval
       → DO NOT drop local buckets

Teardown (called from graceful shutdown):
  → clearInterval
  → Run one final sync attempt (best-effort, timeout 2 s)
  → Return regardless of result
```

**`tokenBucket.drainDeltas()`:** Atomically snapshots and resets local delta counters. Concurrency-safe because Node.js is single-threaded; no mutex needed.

### 6.6 Redis Unavailability Handling

| Mode | Behaviour on Redis unavailability |
|---|---|
| `local` | No Redis calls — never affected |
| `hybrid` | Sync task logs warning; rate limiting continues on local buckets; health returns `redis: degraded`; app keeps running |
| `redis-primary` | Operation fails; caller receives error; health returns `redis: degraded` |

**Health endpoint:** Redis `degraded` does not trigger 503. Only DB disconnection triggers 503 (PRD §5.6).

---

## 7. PostgreSQL Connector Design

Decision trace: D-02, D-08, D-09.

### 7.1 Interface

```typescript
interface PostgresConnector {
  connect(): Promise<void>;    // retry loop; throws after max retries
  healthCheck(): Promise<'connected' | 'disconnected'>;
  teardown(): Promise<void>;   // pool.end()
  db: ReturnType<typeof drizzle>; // exported for route handlers
}
```

### 7.2 Pool Configuration

File: `src/connectors/postgres/pool.ts`

```typescript
new Pool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  database: config.DB_NAME,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  min: config.DB_POOL_MIN,     // default 2
  max: config.DB_POOL_MAX,     // default 10
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: config.DB_SSL ? { rejectUnauthorized: true } : false,
})
```

**Pool metrics:** `db_pool_connections_active` and `db_pool_connections_idle` gauges read from `pool.totalCount`, `pool.idleCount`, `pool.waitingCount` on each `/metrics` scrape.

### 7.3 Startup Retry Logic

File: `src/connectors/postgres/index.ts`

```
connect():
  attempt = 0
  while attempt < DB_CONNECT_MAX_RETRIES:
    try:
      await pool.query('SELECT 1')   ← liveness check
      init drizzle(pool)
      log.info('postgres connected')
      return
    catch err:
      attempt++
      if attempt >= DB_CONNECT_MAX_RETRIES:
        log.fatal({ err }, 'postgres: max retries exceeded')
        process.exit(1)
      backoff = min(DB_CONNECT_RETRY_BASE_MS * 2^attempt + jitter, 30_000)
      log.warn({ attempt, backoffMs: backoff }, 'postgres: retrying')
      await sleep(backoff)
```

**Jitter:** `Math.random() * 0.3 * base_backoff` added to prevent thundering herd on container restart.

**Env vars:**

| Var | Type | Default | Description |
|---|---|---|---|
| `DB_CONNECT_MAX_RETRIES` | number | `5` | Max startup retry attempts before crash |
| `DB_CONNECT_RETRY_BASE_MS` | number | `500` | Base backoff in ms; doubles each attempt |

### 7.4 Runtime Reconnection

The `pg` Pool handles runtime reconnection internally. On connection loss, the pool:
1. Removes the broken connection from the pool.
2. Emits an `error` event (logged by Pino; does not crash the process).
3. Establishes new connections up to `DB_POOL_MAX` on the next query.

The `/health` endpoint's `healthCheck()` issues `SELECT 1` to detect pool-level unavailability. No custom reconnect loop needed at runtime — this is a pool concern.

### 7.5 Read Replica Slot (Future — D-09)

The connector architecture leaves a named slot:
- `src/connectors/postgres/index.ts` exports `primaryDb` (the `drizzle` instance over the write pool).
- A future `replicaDb` export can be added without modifying any other module.
- Documented in `DEPLOYMENT.md` stub (not part of v1 implementation).

### 7.6 Health Check

```typescript
healthCheck(): Promise<'connected' | 'disconnected'>
  → pool.query('SELECT 1')
  → return 'connected' on success
  → return 'disconnected' on any error (logged; not thrown)
```

Timeout: 2 s on the health check query (set via `connectionTimeoutMillis` at health check call site).

---

## 8. Graceful Shutdown Sequence

Decision trace: D-10.

Plugin: `@fastify/close-with-grace`. Signals handled: `SIGTERM`, `SIGINT`, `SIGUSR2` (D-10).

### 8.1 Shutdown Steps (strict order)

```
Signal received (SIGTERM | SIGINT | SIGUSR2)
         │
         ▼
Step 1: @fastify/close-with-grace activates
        → Stops accepting new connections
        → Begins draining in-flight requests
        → Drain window: SHUTDOWN_GRACE_MS (default 30 000 ms)
        → If drain completes before timeout: proceed to Step 2
        → If timeout exceeded: force-close remaining connections;
          log error; proceed to Step 2
         │
         ▼
Step 2: Stop Redis sync task
        src/connectors/redis/syncTask.ts
        → clearInterval
        → Best-effort final sync (timeout 2 s)
         │
         ▼
Step 3: Teardown Redis connector
        src/connectors/redis/index.ts
        → client.quit() (graceful disconnect)
        → timeout 5 s; force-disconnect if exceeded
         │
         ▼
Step 4: Teardown PostgreSQL connector
        src/connectors/postgres/index.ts
        → pool.end()
        → Waits for all active pool clients to finish
        → timeout 10 s; force-close if exceeded
         │
         ▼
Step 5: Stop metrics server
        src/server/metricsServer.ts
        → fastify.close()
         │
         ▼
Step 6: process.exit(0)
```

**Timeout budget:**
- Total budget = `SHUTDOWN_GRACE_MS` (default 30 000 ms).
- Step 1 drain consumes most of the budget.
- Steps 2–5 are expected to complete in < 5 s total under normal conditions.
- Hard exit via `process.exit(1)` if any step takes longer than individual step timeout.

**Env vars:**

| Var | Type | Default | Description |
|---|---|---|---|
| `SHUTDOWN_GRACE_MS` | number | `30000` | Total graceful shutdown window in ms |

### 8.2 close-with-grace Registration

```typescript
// src/app.ts
import closeWithGrace from '@fastify/close-with-grace';

closeWithGrace(
  { delay: config.SHUTDOWN_GRACE_MS },
  async ({ signal, err, manual }) => {
    if (err) logger.error({ err }, 'unhandled error — shutting down');
    await redisConnector.teardown();
    await postgresConnector.teardown();
    await fastify.close();
  }
);
```

The plugin is registered before routes so it captures all in-flight requests.

---

## 9. Observability Design

Decision trace: D-03, D-11.

### 9.1 Pino Logger Configuration

File: `src/observability/logger/index.ts`

**Dev mode** (`NODE_ENV=development`):
```typescript
{
  level: config.LOG_LEVEL ?? 'debug',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard' },
  },
  redact: ['password', 'token', 'secret', 'authorization', 'cookie',
            '*.password', '*.token', '*.secret'],
}
```

**Production / all other envs:**
```typescript
{
  level: config.LOG_LEVEL ?? 'info',
  // No transport — writes raw JSON to stdout
  redact: ['password', 'token', 'secret', 'authorization', 'cookie',
            '*.password', '*.token', '*.secret'],
}
```

**Request log fields (Fastify built-in access log):**

| Field | Source |
|---|---|
| `timestamp` | Pino (ISO 8601) |
| `level` | Pino |
| `correlationId` | Bound via child logger in correlationId middleware |
| `reqId` | Fastify auto-generated request ID |
| `method` | `request.method` |
| `url` | `request.url` |
| `statusCode` | `reply.statusCode` |
| `responseTime` | Fastify built-in (ms) |
| `msg` | `"request completed"` |

### 9.2 Correlation ID Lifecycle

```
1. onRequest hook (correlationId middleware):
   → Read X-Correlation-Id from request header
   → If absent: generate crypto.randomUUID()
   → Attach to request.correlationId
   → Create Pino child logger: logger.child({ correlationId })
   → Attach child logger to request (used by all downstream logs)

2. All log lines within the request lifecycle:
   → Automatically include correlationId (from child logger binding)

3. onSend hook:
   → reply.header('X-Correlation-Id', request.correlationId)

4. Background tasks (syncTask, circuitBreaker sweep):
   → Use static correlationId: 'background-<task-name>'
```

### 9.3 Metrics Registry

File: `src/observability/metrics/registry.ts`

```typescript
import { Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });
```

Using a named registry (not the global default) avoids conflicts in test isolation where multiple registry instances may be created.

### 9.4 Metrics Definitions

File: `src/observability/metrics/definitions.ts`

All metrics are registered against the named `registry`.

| Metric name | Type | Labels | Description |
|---|---|---|---|
| `http_request_duration_ms` | Histogram | `method`, `route`, `status_code` | Request duration in ms. Buckets: `[1, 5, 10, 25, 50, 100, 250, 500, 1000]` |
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP requests handled |
| `db_pool_connections_active` | Gauge | — | Active pg pool connections (`pool.totalCount - pool.idleCount`) |
| `db_pool_connections_idle` | Gauge | — | Idle pg pool connections (`pool.idleCount`) |
| `rate_limit_rejected_total` | Counter | `layer` (`ip` \| `global` \| `new_ip`) | Rate limit rejections per layer |
| `redis_sync_duration_ms` | Histogram | — | Background sync round-trip duration. Buckets: `[5, 10, 25, 50, 100, 250, 500]` |
| `redis_sync_errors_total` | Counter | — | Failed background sync attempts |

**Default Node.js metrics** (from `collectDefaultMetrics`):
`process_cpu_user_seconds_total`, `process_cpu_system_seconds_total`, `process_resident_memory_bytes`, `nodejs_heap_size_total_bytes`, `nodejs_heap_size_used_bytes`, `nodejs_event_loop_lag_seconds`, and others.

### 9.5 Metrics Recording Points

| Metric | Recorded in |
|---|---|
| `http_request_duration_ms`, `http_requests_total` | `onResponse` hook in `app.ts` |
| `db_pool_connections_active`, `db_pool_connections_idle` | `GET /metrics` handler (point-in-time read) |
| `rate_limit_rejected_total` | `src/middleware/rateLimit/index.ts` on each 429 |
| `redis_sync_duration_ms`, `redis_sync_errors_total` | `src/connectors/redis/syncTask.ts` |

### 9.6 Tracing Slot

```typescript
// src/middleware/tracingSlot/index.ts
// v1: no-op placeholder for future OpenTelemetry injection
export async function tracingMiddleware(
  _request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Future: extract/create span, attach to request context
}
```

Registered in plugin order between correlation ID and rate limiting. Zero overhead in v1.

---

## 10. Configuration Schema

File: `src/config/index.ts`

`loadConfig()` parses `process.env` against this Zod schema. On any validation failure, it collects **all** errors (not just the first), formats them as a numbered list, and throws with `process.exit(1)`. Environment variables are never logged.

### 10.1 Complete Env Var Table

#### Server

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `NODE_ENV` | `development\|test\|production` | No | `production` | Controls Pino transport and log level defaults |
| `PORT` | number | No | `3000` | Application HTTP listen port |
| `HOST` | string | No | `0.0.0.0` | Application bind address |
| `METRICS_PORT` | number | No | `9090` | Separate Prometheus metrics server port (D-11) |
| `SHUTDOWN_GRACE_MS` | number | No | `30000` | Graceful shutdown drain window in ms |

#### Logging

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `LOG_LEVEL` | `trace\|debug\|info\|warn\|error\|fatal` | No | `info` (prod), `debug` (dev) | Pino log level |

#### Database (PostgreSQL)

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `DB_HOST` | string | Yes | — | PostgreSQL host (or PgBouncer host) |
| `DB_PORT` | number | No | `5432` | PostgreSQL port |
| `DB_NAME` | string | Yes | — | Database name |
| `DB_USER` | string | Yes | — | Database user |
| `DB_PASSWORD` | string | Yes | — | Database password (redacted from all logs) |
| `DB_SSL` | boolean | No | `false` | Enable SSL for PostgreSQL connection |
| `DB_POOL_MIN` | number | No | `2` | Minimum pool connections |
| `DB_POOL_MAX` | number | No | `10` | Maximum pool connections |
| `DB_CONNECT_MAX_RETRIES` | number | No | `5` | Max connection attempts at startup before crash |
| `DB_CONNECT_RETRY_BASE_MS` | number | No | `500` | Base backoff ms for startup retry (doubles each attempt) |

#### Redis

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `REDIS_MODE` | `local\|hybrid\|redis-primary` | No | `local` | Redis operation mode (D-05) |
| `REDIS_TOPOLOGY` | `standalone\|cluster` | No | `standalone` | ioredis client topology (D-06); ignored when `REDIS_MODE=local` |
| `REDIS_HOST` | string | Conditional | — | Redis host; required if `REDIS_MODE` != `local` and `REDIS_TOPOLOGY=standalone` |
| `REDIS_PORT` | number | No | `6379` | Redis port |
| `REDIS_PASSWORD` | string | No | — | Redis password (redacted from all logs) |
| `REDIS_DB` | number | No | `0` | Redis database index (standalone only) |
| `REDIS_CLUSTER_NODES` | string (JSON) | Conditional | — | JSON array of `{host, port}` objects; required if `REDIS_TOPOLOGY=cluster` |
| `REDIS_SYNC_INTERVAL_MS` | number | No | `10000` | Background sync interval in ms (hybrid mode only) |

#### Rate Limiting

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `RATE_LIMIT_DISABLED` | boolean | No | `false` | Disables all rate limiting globally |
| `RATE_LIMIT_BYPASS_CIDRS` | string | No | — | Comma-separated IP/CIDR allowlist; matching IPs skip all layers |
| `RL_IP_MAX_TOKENS` | number | No | `100` | Token bucket burst capacity per IP |
| `RL_IP_REFILL_RATE` | number | No | `10` | Token refill rate per second per IP |
| `RL_MAX_IPS` | number | No | `500000` | LRU Map capacity cap (~75 MB) |
| `RL_NEW_IP_RATE_MAX` | number | No | `1000` | Max new unique IPs per second (Layer 1b) |
| `LATENCY_CB_DELTA_MS` | number | No | `5` | ms above EMA baseline to open the circuit (Layer 1a) |
| `LATENCY_CB_WINDOW_SIZE` | number | No | `10000` | Ring buffer size for latency tracking |
| `LATENCY_CB_CHECK_INTERVAL_MS` | number | No | `100` | Background p99 recompute interval ms |
| `LATENCY_CB_RECOVERY_MS` | number | No | `5000` | Time in OPEN before HALF_OPEN probe |
| `LATENCY_CB_WARMUP_MS` | number | No | `30000` | Warmup period ms; circuit never trips during warmup |

#### Security

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | string | Yes | — | Comma-separated list of allowed CORS origins |
| `BODY_SIZE_LIMIT` | string | No | `100kb` | Maximum request body size (Fastify format: `100kb`, `1mb`) |
| `TRUSTED_PROXY_DEPTH` | number | No | `2` | X-Forwarded-For offset for real client IP extraction (D-07) |

### 10.2 Validation Behaviour

- All errors collected before throwing (Zod `safeParse` + error accumulation).
- Error output format:
  ```
  Configuration errors — fix these env vars before starting:
    1. DB_HOST: Required
    2. DB_USER: Required
    3. CORS_ALLOWED_ORIGINS: Required
  ```
- Redis-specific vars (`REDIS_HOST`, `REDIS_CLUSTER_NODES`) use Zod `superRefine` for conditional validation based on `REDIS_MODE` and `REDIS_TOPOLOGY`.

---

## 11. Error Handling Contract

### 11.1 Standard Error Response Shape

Defined in `src/types/index.ts`:

```typescript
interface StandardErrorResponse {
  error: {
    code: string;
    message: string;
    statusCode: number;
    correlationId: string;
  };
}
```

All error responses — regardless of source — use this shape. No stack traces are ever included in API responses.

### 11.2 HTTP Status to Error Code Mapping

| HTTP Status | `error.code` | Source | Notes |
|---|---|---|---|
| `400` | `VALIDATION_ERROR` | Zod schema; invalid JSON | `message` includes field path and failure reason |
| `413` | `PAYLOAD_TOO_LARGE` | Body size guard | `message` states the configured limit |
| `429` | `RATE_LIMIT_EXCEEDED` | Any rate limit layer | `Retry-After` header set; `message` states retry window |
| `500` | `INTERNAL_ERROR` | Fastify `setErrorHandler` | Catch-all; original error logged with correlationId; never leaked to client |
| `503` | `SERVICE_UNAVAILABLE` | `GET /health` only | DB disconnection; full body follows HealthResponse shape, not StandardErrorResponse |

### 11.3 Fastify Global Error Handler

Registered in `app.ts`:

```typescript
fastify.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode ?? 500;
  request.log.error({ err: error, statusCode }, 'request error');
  reply.status(statusCode).send({
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: statusCode === 500 ? 'An internal error occurred' : error.message,
      statusCode,
      correlationId: request.correlationId,
    },
  } satisfies StandardErrorResponse);
});
```

**Principle:** 500 errors replace the message with a generic string; original error message is only in logs.

### 11.4 Async Error Handling

All `async` route handlers and hooks are wrapped by Fastify's built-in promise rejection capture. Unhandled rejections are routed to the global error handler. No uncaught promise rejections are allowed.

Background tasks (`syncTask`, circuit breaker sweep) catch their own errors internally; they log and continue — they never crash the process.

---

## 12. Docker Compose Topology

Decision trace: D-17.

File: `docker/docker-compose.yml`

### 12.1 Services

```
┌─────────────────────────────────────────────────────────────┐
│  Docker Compose (local dev)                                 │
│                                                             │
│  ┌───────────┐   ┌──────────────┐   ┌─────────────────┐   │
│  │ postgres  │   │  pgbouncer   │   │     redis       │   │
│  │ :5432     │◄──│  :6432       │   │   :6379         │   │
│  │           │   │              │   │                 │   │
│  │ image:    │   │ image:       │   │ image:          │   │
│  │ postgres  │   │ pgbouncer/   │   │ redis:7-alpine  │   │
│  │ :16-alpine│   │ pgbouncer    │   │                 │   │
│  └───────────┘   └──────────────┘   └─────────────────┘   │
│                         ▲                                   │
│                         │ DB_HOST=pgbouncer, DB_PORT=6432   │
│                         │                                   │
│               Application (not a service;                   │
│               runs outside compose for dev)                 │
└─────────────────────────────────────────────────────────────┘
```

### 12.2 Service Definitions

**postgres:**
```yaml
image: postgres:16-alpine
environment:
  POSTGRES_DB: appdb
  POSTGRES_USER: appuser
  POSTGRES_PASSWORD: apppassword
ports:
  - "5432:5432"
volumes:
  - pgdata:/var/lib/postgresql/data
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U appuser -d appdb"]
  interval: 5s
  timeout: 5s
  retries: 5
```

**pgbouncer:**
```yaml
image: pgbouncer/pgbouncer:latest
depends_on:
  postgres:
    condition: service_healthy
ports:
  - "6432:6432"
volumes:
  - ./pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro
  - ./pgbouncer/userlist.txt:/etc/pgbouncer/userlist.txt:ro
```

**redis:**
```yaml
image: redis:7-alpine
ports:
  - "6379:6379"
healthcheck:
  test: ["CMD", "redis-cli", "ping"]
  interval: 5s
  timeout: 3s
  retries: 5
```

### 12.3 PgBouncer Configuration

File: `docker/pgbouncer/pgbouncer.ini`

```ini
[databases]
appdb = host=postgres port=5432 dbname=appdb

[pgbouncer]
pool_mode = transaction
max_client_conn = 200
default_pool_size = 20
min_pool_size = 5
reserve_pool_size = 5
reserve_pool_timeout = 3
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
logfile = /var/log/pgbouncer/pgbouncer.log
pidfile = /var/run/pgbouncer/pgbouncer.pid
```

**Pool mode:** `transaction` — connection returned to pool after each transaction. Compatible with Drizzle and the `pg` pool because prepared statements are not used across transactions.

### 12.4 Environment File for Local Dev

`.env.local` (gitignored; `.env.example` checked in):

```
NODE_ENV=development
PORT=3000
METRICS_PORT=9090
DB_HOST=localhost
DB_PORT=6432
DB_NAME=appdb
DB_USER=appuser
DB_PASSWORD=apppassword
DB_POOL_MIN=2
DB_POOL_MAX=10
REDIS_MODE=hybrid
REDIS_TOPOLOGY=standalone
REDIS_HOST=localhost
REDIS_PORT=6379
CORS_ALLOWED_ORIGINS=http://localhost:3000
LOG_LEVEL=debug
```

---

## 13. Test Architecture

Decision trace: D-12, D-13.

### 13.1 Directory Structure

```
tests/
├── unit/
│   ├── config/
│   ├── middleware/
│   │   ├── rateLimit/
│   │   │   ├── latencyCircuitBreaker.test.ts
│   │   │   ├── newIpLimiter.test.ts
│   │   │   ├── tokenBucket.test.ts
│   │   │   └── ipExtractor.test.ts
│   │   ├── correlationId.test.ts
│   │   └── validation.test.ts
│   ├── connectors/
│   │   ├── postgres.test.ts
│   │   └── redis.test.ts
│   └── observability/
│       ├── logger.test.ts
│       └── metrics.test.ts
├── integration/
│   ├── health.test.ts
│   ├── rateLimit.test.ts
│   └── gracefulShutdown.test.ts
└── benchmarks/
    └── middleware-overhead.ts
```

### 13.2 Unit Tests

**Framework:** Vitest (TypeScript, strict mode)

**Scope:** Pure logic only — no I/O.

**Connector mocking:** `vi.mock` or manual stubs that satisfy `PostgresConnector` / `RedisConnector` interfaces. No `pg-mem` or `ioredis-mock` (D-12).

**Key unit test areas:**

| Area | What is tested |
|---|---|
| `config/index.ts` | Valid config parses; missing required vars throw with full error list; conditional Redis validation |
| `tokenBucket.ts` | Token refill math; LRU eviction at cap; `Retry-After` calculation; `drainDeltas()` atomic snapshot |
| `latencyCircuitBreaker.ts` | State machine transitions; warmup suppression; EMA computation; ring buffer behavior |
| `newIpLimiter.ts` | New IP counting; window reset; returning-IP bypass |
| `ipExtractor.ts` | XFF parsing with various proxy depths; spoofing-vector cases; fallback to `req.ip` |
| `correlationId` middleware | Header read; UUID generation; child logger binding; response header injection |
| `syncTask.ts` | Delta drain; pipeline construction; error handling (Redis throws); teardown flush |
| `observability/logger` | Pino config shape for dev vs prod; redact paths present |

**Vitest config:** `vitest.config.ts` with `coverage.provider: 'v8'`. Tests run sequentially (`--pool=forks --poolOptions.forks.singleFork=true`) to avoid port conflicts. `SCAFFOLD_DEPTH` guard for recursive spawn protection (see memory).

### 13.3 Integration Tests

**Framework:** Vitest + Testcontainers (D-12)

**Testcontainers setup:** Each integration test file that needs real infrastructure starts containers in `beforeAll` and stops them in `afterAll`. Containers are not shared across test files to prevent state bleed.

```typescript
// Pattern for each integration test file

let postgresContainer: StartedPostgreSQLContainer;
let redisContainer: StartedRedisContainer;
let app: FastifyInstance;

beforeAll(async () => {
  postgresContainer = await new PostgreSQLContainer('postgres:16-alpine').start();
  redisContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .start();

  const config = buildTestConfig({
    DB_HOST: postgresContainer.getHost(),
    DB_PORT: postgresContainer.getMappedPort(5432),
    REDIS_HOST: redisContainer.getHost(),
    REDIS_PORT: redisContainer.getMappedPort(6379),
    REDIS_MODE: 'hybrid',
  });

  app = await buildApp(config);
  await app.listen({ port: 0 }); // random port
}, 60_000); // 60s timeout for container startup

afterAll(async () => {
  await app.close();
  await postgresContainer.stop();
  await redisContainer.stop();
});
```

**Key integration test areas:**

| Test file | Scenarios covered |
|---|---|
| `health.test.ts` | 200 with all deps up; 503 when DB container stopped; 200 with `redis: degraded` when Redis container stopped |
| `rateLimit.test.ts` | Per-IP bucket exhaustion → 429 + Retry-After; global CB trip; bypass CIDR; RATE_LIMIT_DISABLED; Layer 1b new-IP flood |
| `gracefulShutdown.test.ts` | SIGTERM drains in-flight; exit 0; zero dropped requests; shutdown within SHUTDOWN_GRACE_MS |

### 13.4 Benchmark Harness

Decision trace: D-13.

File: `tests/benchmarks/middleware-overhead.ts`

**Method:**
1. Start a bare Fastify server (no middleware, no rate limiting, no observability) with a `GET /noop` route that returns `{ ok: true }`.
2. Run `autocannon` for 10 s, 10 connections. Record p99 latency = `baseline_p99`.
3. Start the full app (all middleware registered) with the same `GET /noop` route added.
4. Run the same autocannon load. Record p99 = `full_p99`.
5. `delta = full_p99 - baseline_p99`.
6. Assert `delta <= 1` (ms). If exceeded, print both values and exit with code 1.

**CI integration:** The benchmark script is a standalone Node.js/TypeScript script (`tsx tests/benchmarks/middleware-overhead.ts`). CI runs it after unit and integration tests. Failure fails the CI pipeline.

**Caveat:** Benchmark results are environment-sensitive (CI runner CPU). The 1 ms target is validated on a dedicated benchmark machine or a consistent CI runner spec. The first failing CI run should prompt a calibration review before enforcing.

### 13.5 Coverage Gate

- Coverage tooling: Vitest with `v8` provider.
- Coverage gates enforced in Phase 8 only: ≥ 95% lines, branches, functions, statements.
- Coverage report output: `tests/coverage/` (HTML + LCOV).
- Not enforced per-chunk; enforced only in the final system test pass.

---

## Appendix A — Decision Traceability

| Design element | Decision(s) |
|---|---|
| Fastify as framework | D-01 |
| Drizzle ORM + pg pool | D-02 |
| Pino logger; pino-pretty in dev | D-03 |
| Three-layer rate limiting | D-04 |
| Redis operation modes | D-05 |
| Redis factory / topology | D-06 |
| IP extraction via XFF + TRUSTED_PROXY_DEPTH | D-07 |
| DB startup retry; crash after max retries | D-08 |
| Read replica slot (future, not implemented) | D-09 |
| @fastify/close-with-grace; SIGTERM+SIGINT+SIGUSR2 | D-10 |
| Metrics on separate port | D-11 |
| Testcontainers for integration; mocks for unit | D-12 |
| autocannon benchmark harness | D-13 |
| Latency CB env vars and EMA | D-14 |
| TypeScript strict; ESLint airbnb-base | D-15 |
| Server config defaults (PORT, HOST, METRICS_PORT) | D-16 |
| Docker Compose with Postgres + PgBouncer + Redis | D-17 |

All 17 decisions in `docs/decisions.md` are covered. No new architecture decisions were introduced in this document. No UNRESOLVEDs found.

---

## Appendix B — Out of Scope (v1)

The following are explicitly excluded from this design. Mentioning them here prevents scope creep during implementation:

- Authentication implementations (JWT, API key, mTLS) — middleware slot registered as no-op
- OpenTelemetry distributed tracing — tracing slot registered as no-op
- Read replica pool — connector slot documented, not implemented
- Message queue connectors (BullMQ, SQS)
- Kubernetes manifests
- CI/CD pipeline templates (GitHub Actions)
- Per-route rate limit overrides
- `redis-primary` mode for rate limiting
- PgBouncer, Redis Cluster, load balancer configuration (documented in `DEPLOYMENT.md` stub only)
