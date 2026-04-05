# Decision Log (DAR)

All implementation decisions resolved during Phase 2 technical planning.

---

## D-01 — HTTP Framework
**Decision:** Fastify
**Reason:** Lowest overhead in Node.js HTTP space; ~2× faster than Express; JSON schema serialisation built-in; native Pino integration.

---

## D-02 — ORM
**Decision:** Drizzle ORM over `pg` (node-postgres)
**Reason:** No query engine runtime — compiles to raw SQL; type-safe; SQL-close API; zero magic for freshers to navigate.

---

## D-03 — Structured Logger
**Decision:** Pino (via Fastify's built-in logger)
**Reason:** Lowest-latency structured logger in Node.js; native to Fastify; Winston would add unnecessary overhead.
**Format:** `pino-pretty` when `NODE_ENV=development`; raw JSON for all other environments (UAT, production).

---

## D-04 — Rate Limiting Architecture
**Decision:** Three-layer design

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| 1a | Latency-based circuit breaker | Opens when p99 latency rises > `LATENCY_CB_DELTA_MS` (default 5ms) above baseline. Self-calibrating EMA baseline. State: CLOSED → OPEN → HALF-OPEN → CLOSED. |
| 1b | New-IP rate limiter | Caps rate of new unique IPs/sec (`RL_NEW_IP_RATE_MAX`). Returning IPs bypass this layer entirely. Targets rotating-IP DDoS without penalising legitimate users. |
| 2 | Per-IP token bucket (LRU Map) | `RL_IP_MAX_TOKENS=100` (burst), `RL_IP_REFILL_RATE=10` (tokens/sec). LRU cap: `RL_MAX_IPS=500000` (~75 MB). |

**Modes:** `disabled` | `ip-based` | `ip-based-with-bypass`
**Bypass:** `RATE_LIMIT_BYPASS_CIDRS` — comma-separated IP/CIDR allowlist (internal mesh subnets skip all layers).
**Disable:** `RATE_LIMIT_DISABLED=true` — disables all layers.

---

## D-05 — Redis Operation Modes
**Decision:** Three modes via `REDIS_MODE` env var

| Mode | Behaviour |
|------|-----------|
| `local` (default) | In-memory only; no Redis calls |
| `hybrid` | In-memory fast path + async background sync every `REDIS_SYNC_INTERVAL_MS` (default 10 000 ms) |
| `redis-primary` | Synchronous Redis on every op; reserved for non-rate-limit use cases |

Rate limiting always uses `local` or `hybrid` — never `redis-primary`.
**Data loss tolerance:** rate limit counters may lose partial data on instance restart or Redis unavailability. Explicitly accepted. No other data stored with loss tolerance.

---

## D-06 — Redis Topology
**Decision:** Factory pattern at startup. `REDIS_TOPOLOGY=standalone|cluster`.
**Reason:** Switching topology at runtime is unsafe (different ioredis client classes, in-flight ops lost). Topology changes are planned infra events done via rolling restart. Factory selects the right ioredis client at boot; both expose the same connector interface.

---

## D-07 — IP Extraction Behind Load Balancer
**Decision:** Read client IP from `X-Forwarded-For` using configurable proxy depth.
**Env var:** `TRUSTED_PROXY_DEPTH` (default `2` — covers API gateway + load balancer).
**Reason:** Blindly trusting `X-Forwarded-For[0]` is a known spoofing vector. Reading `X-Forwarded-For[-TRUSTED_PROXY_DEPTH]` trusts only infrastructure-set entries.

---

## D-08 — DB Startup Behaviour
**Decision:** Retry with exponential backoff at startup; crash after `DB_CONNECT_MAX_RETRIES` (default 5) failures.
**Reason:** Handles container orchestration race conditions (DB container not yet ready). DB connection is established as the first step before server starts accepting traffic.

---

## D-09 — Read Replicas
**Decision:** Future scope. Single primary pool in v1.
**Note:** Connector architecture must leave a clean slot for a read replica pool. Document in `DEPLOYMENT.md`.

---

## D-10 — Graceful Shutdown
**Decision:** `@fastify/close-with-grace` (official Fastify plugin).
**Reason:** Manual drain has subtle production bugs (keep-alive connections, WebSocket upgrades). This plugin handles all edge cases. Drain window: `SHUTDOWN_GRACE_MS` (default 30 000 ms).
**Signals handled:** SIGTERM, SIGINT, SIGUSR2 (PM2 graceful reload).

---

## D-11 — Metrics Endpoint Security
**Decision:** Separate port. Metrics served on `METRICS_PORT` (default `9090`), never on the public application port.
**Reason:** Prevents info-leak of memory, CPU, pool sizes to external clients.

---

## D-12 — Integration Test Strategy
**Decision:** Testcontainers for integration tests; connector mocks for unit tests.
**Reason:** In-memory fakes (`pg-mem`, `ioredis-mock`) miss real engine behaviours (connection pool exhaustion, query errors, TTL precision). Testcontainers spins up real Postgres + Redis Docker containers programmatically — no manual `docker-compose up` step.

---

## D-13 — Latency Benchmark Harness
**Decision:** `autocannon` script in `tests/benchmarks/`.
**Method:** Measure p99 on a bare Fastify route (no middleware) → measure p99 on the full middleware stack → delta must be ≤ 1ms. CI fails if exceeded.
**Reason:** Autocannon measures the real HTTP path (TCP + routing + middleware + serialisation). Vitest in-process benchmarks miss HTTP stack overhead and give a falsely optimistic picture.

---

## D-14 — Latency Circuit Breaker Parameters
**Env vars:**

| Var | Default | Purpose |
|-----|---------|---------|
| `LATENCY_CB_DELTA_MS` | `5` | ms increase over baseline that opens the circuit |
| `LATENCY_CB_WINDOW_SIZE` | `10000` | Ring buffer size (recent requests tracked) |
| `LATENCY_CB_CHECK_INTERVAL_MS` | `100` | Background p99 recompute interval |
| `LATENCY_CB_RECOVERY_MS` | `5000` | Time in OPEN before HALF-OPEN probe |
| `LATENCY_CB_WARMUP_MS` | `30000` | Warmup period — no circuit breaks, baseline seeds |

---

## D-15 — TypeScript + Linting Config
**TypeScript:** `"strict": true` — no additional flags beyond the strict umbrella.
**ESLint:** `eslint-config-airbnb-base` + `@typescript-eslint` overlay. `import/prefer-default-export` off.

---

## D-16 — Server Config Defaults
| Var | Default |
|-----|---------|
| `PORT` | `3000` |
| `HOST` | `0.0.0.0` |
| `METRICS_PORT` | `9090` |

Redis vars (`REDIS_HOST`, `REDIS_PORT`, etc.) are optional when `REDIS_MODE=local`. All other required vars crash-fast at startup with a human-readable list of missing entries.

---

## D-17 — Docker Compose Dev Environment
**Includes:** Postgres + PgBouncer + Redis.
**Location:** `docker/docker-compose.yml` + `docker/pgbouncer/pgbouncer.ini`.
**Purpose:** Local dev parity with production connection pooling topology.

---

## D-18 — Chunk Delivery Order and Dependency Rationale (Planning Phase 4)
**Decision:** Seven-chunk linear delivery sequence:
1. Scaffold + types + utils + helpers + config loader
2. Server factory + Postgres connector + Redis connector + graceful shutdown
3. Security middleware + correlation ID middleware + tracing slot
4. Observability (Pino logger config + Prometheus metrics registry + metric definitions)
5. Rate limiting middleware (all three layers) + input validation middleware
6. Health controller + health route + route index
7. Integration wiring (`app.ts` + `index.ts`) + Docker Compose + benchmark harness

**Reason:** Each chunk is independently reviewable and testable. Chunks 01–02 establish the foundation that all later chunks import from. Observability (Chunk 04) is placed before rate limiting (Chunk 05) so that the `rateLimitRejectedTotal` metric is defined before the code that increments it. Security and correlation ID (Chunk 03) are placed before rate limiting so that 429 responses carry security headers and correlation IDs. The health route (Chunk 06) depends on both connectors (Chunk 02) and observability (Chunk 04 for pool gauges) being in place. Integration wiring (Chunk 07) is last because it is the only chunk that requires every other module to exist.

**No design changes introduced.** This decision records the chunking rationale only. No DAR approval required — this is a planning organisation choice within the approved technical design.
