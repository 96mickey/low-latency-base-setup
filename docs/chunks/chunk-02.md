# Chunk 02: Server Factory, PostgreSQL Connector, Redis Connector, Graceful Shutdown

**Status:** Planned
**Depends on:** Chunk 01
**PRD References:** FR-01, FR-02, FR-03, AC-02, AC-03, AC-12, EC-01, EC-02, EC-03, EC-04, EC-05

---

## What This Chunk Delivers

After this chunk is merged the system can boot a Fastify HTTP server, establish a real PostgreSQL connection (with retry/backoff), and connect to Redis in all three operation modes (`local`, `hybrid`, `redis-primary`). The server shuts down cleanly on SIGTERM/SIGINT/SIGUSR2, draining in-flight requests before closing pools. A caller can `buildApp(config)` and `app.listen()` — the minimal wiring that makes a running server — even before any routes or middleware are added. The metrics server process (`metricsServer.ts`) is also created in this chunk, though it will serve meaningful metrics data only after Chunk 04.

---

## Explicit Scope

### In Scope
- [ ] `src/server/factory.ts` — `createFastifyInstance(config, logger)`: constructs the Fastify instance with the Pino logger and base options; no plugins registered here
- [ ] `src/server/metricsServer.ts` — standalone Fastify instance on `METRICS_PORT`; single `GET /metrics` route that returns an empty 200 (will be wired to the real registry in Chunk 04); lifecycle exported
- [ ] `src/connectors/postgres/pool.ts` — `createPool(config)`: `pg.Pool` with env-driven sizing; exports pool for Drizzle
- [ ] `src/connectors/postgres/schema.ts` — empty Drizzle schema placeholder file (consumer teams add tables here)
- [ ] `src/connectors/postgres/index.ts` — `connect()` with startup retry loop (D-08); `healthCheck()` with `SELECT 1` and 2 s timeout; `teardown()` via `pool.end()`; exports `PostgresConnector` object and `primaryDb` (Drizzle instance)
- [ ] `src/connectors/redis/standaloneClient.ts` — ioredis `Redis` wrapper; `lazyConnect: true`; retry strategy via `helpers/retry.ts`; `healthCheck()` via `PING`; `teardown()` via `client.quit()`
- [ ] `src/connectors/redis/clusterClient.ts` — ioredis `Cluster` wrapper; reads `REDIS_CLUSTER_NODES`; same interface as standalone
- [ ] `src/connectors/redis/factory.ts` — `createRedisConnector(config)`: selects `LocalStub` | `standaloneClient` | `clusterClient` based on `REDIS_MODE` and `REDIS_TOPOLOGY`; `LocalStub` is a no-op that always returns `'connected'` from `healthCheck()`
- [ ] `src/connectors/redis/index.ts` — `connect()`, `healthCheck()`, `teardown()` delegating to the factory-selected client; exports active client reference
- [ ] `src/connectors/redis/syncTask.ts` — background `setInterval` task (active only in `hybrid` mode); `start(redisClient, tokenBucketRef, config)`, `stop()` with best-effort final sync; at this stage the `tokenBucketRef` is a stub/no-op (real implementation wired in Chunk 05); error handling per §6.5 of technical design
- [ ] `@fastify/close-with-grace` registered in the server factory or app bootstrap; handles SIGTERM, SIGINT, SIGUSR2; `SHUTDOWN_GRACE_MS` drain window; calls `redisConnector.teardown()` → `postgresConnector.teardown()` → `fastify.close()` in order
- [ ] Unit tests: postgres connector (mocked `pg.Pool`), redis connector (mocked ioredis), factory selection logic, syncTask start/stop/error handling
- [ ] Integration test stub file created at `tests/integration/gracefulShutdown.test.ts` — test bodies written (they will pass in Chunk 07 after full wiring)

### Out of Scope
- We are NOT registering security middleware, rate limiting, correlation ID, or validation (Chunks 03 and 05)
- We are NOT creating observability (logger module, metrics definitions) — the server uses Fastify's built-in Pino logger with default options; observability module built in Chunk 04
- We are NOT creating health or metrics routes — `GET /health` controller and route come in Chunk 06; `GET /metrics` returns a stub 200 in this chunk
- We are NOT creating `src/app.ts` or `src/index.ts` — full integration wiring comes in Chunk 07
- We are NOT creating Docker Compose files (Chunk 07)

---

## Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `src/server/factory.ts` | Create | Fastify instance factory; logger options; no plugin registration |
| `src/server/metricsServer.ts` | Create | Separate Fastify on METRICS_PORT; stub GET /metrics → 200 |
| `src/connectors/postgres/pool.ts` | Create | pg.Pool with env sizing |
| `src/connectors/postgres/schema.ts` | Create | Empty Drizzle schema placeholder |
| `src/connectors/postgres/index.ts` | Create | connect/healthCheck/teardown; retry loop; exports primaryDb |
| `src/connectors/redis/standaloneClient.ts` | Create | ioredis.Redis wrapper |
| `src/connectors/redis/clusterClient.ts` | Create | ioredis.Cluster wrapper |
| `src/connectors/redis/factory.ts` | Create | LocalStub + client selector |
| `src/connectors/redis/index.ts` | Create | Delegates to factory client |
| `src/connectors/redis/syncTask.ts` | Create | Background sync; start/stop; error handling |
| `tests/unit/connectors/postgres.test.ts` | Create | Mocked pool; retry logic; healthCheck paths |
| `tests/unit/connectors/redis.test.ts` | Create | Mocked ioredis; factory selection; healthCheck paths; syncTask |
| `tests/integration/gracefulShutdown.test.ts` | Create | Test bodies written; will fully pass in Chunk 07 |

---

## Data Model

```typescript
// src/connectors/postgres/index.ts exports
interface PostgresConnector {
  connect(): Promise<void>;
  healthCheck(): Promise<'connected' | 'disconnected'>;
  teardown(): Promise<void>;
  db: ReturnType<typeof drizzle>; // primaryDb — Drizzle instance
}

// src/connectors/redis/index.ts exports
interface RedisConnector {
  connect(): Promise<void>;
  healthCheck(): Promise<'connected' | 'degraded'>;
  teardown(): Promise<void>;
  pipeline(): RedisPipeline;
  get(key: string): Promise<string | null>;
}

// src/connectors/redis/syncTask.ts exports
interface SyncTask {
  start(client: RedisConnector, getDeltas: () => Map<string, number>, config: Config): void;
  stop(): Promise<void>; // clearInterval + best-effort final sync (timeout 2 s)
}
```

---

## API Contract

No application HTTP endpoints in this chunk.

`GET /metrics` (port `METRICS_PORT`) returns stub 200 with empty body. This is intentional — the real metrics registry is wired in Chunk 04. The route must exist so the server starts without errors.

---

## Acceptance Criteria

- [ ] AC-C02-01: `createFastifyInstance(config, logger)` returns a Fastify instance that can be started and stopped without errors
- [ ] AC-C02-02: `postgres.connect()` retries up to `DB_CONNECT_MAX_RETRIES` times with exponential backoff + jitter on connection failure, then throws
- [ ] AC-C02-03: `postgres.healthCheck()` returns `'connected'` when `SELECT 1` succeeds; returns `'disconnected'` (does not throw) when the query fails
- [ ] AC-C02-04: `postgres.teardown()` calls `pool.end()` without throwing
- [ ] AC-C02-05: `redis.factory` returns `LocalStub` when `REDIS_MODE=local`; `standaloneClient` when `REDIS_MODE=hybrid, REDIS_TOPOLOGY=standalone`; `clusterClient` when `REDIS_MODE=hybrid, REDIS_TOPOLOGY=cluster`
- [ ] AC-C02-06: `redis.healthCheck()` on the standalone client issues `PING` and returns `'connected'` on success; returns `'degraded'` (does not throw) on error
- [ ] AC-C02-07: `LocalStub.healthCheck()` always returns `'connected'` without making any network call
- [ ] AC-C02-08: `syncTask.stop()` calls `clearInterval` and performs a best-effort final sync; does not throw if the final sync errors
- [ ] AC-C02-09: `syncTask` on Redis error during a sync tick logs a warning, increments no counter (metrics not wired yet), and continues — does not crash
- [ ] AC-C02-10: Fastify server registered with `@fastify/close-with-grace` stops accepting connections on SIGTERM and calls teardown functions in the correct order: redis → postgres → fastify.close()
- [ ] AC-C02-11: All unit tests for this chunk pass (`npm run test:unit`)

---

## Performance Targets

| Metric | Target |
|--------|--------|
| `postgres.connect()` first attempt | Completes within `connectionTimeoutMillis` (5 s) |
| `postgres.healthCheck()` | Completes within 2 s (per technical design §7.6) |
| Graceful shutdown total | ≤ `SHUTDOWN_GRACE_MS` (30 s default) — verified in integration test (Chunk 07) |

---

## Security Requirements

- [ ] `DB_PASSWORD` and `REDIS_PASSWORD` must never appear in any log line produced by the connectors — Pino `redact` is configured on the logger passed to connectors
- [ ] `pg.Pool` must be created with `ssl: config.DB_SSL ? { rejectUnauthorized: true } : false` — no self-signed cert bypass when SSL is enabled
- [ ] ioredis `enableReadyCheck: true` to prevent use of a not-yet-ready connection

---

## Error Scenarios to Handle

| Scenario | Expected Behaviour |
|----------|-------------------|
| DB unreachable at startup (EC-01) | `postgres.connect()` retries with backoff; after max retries logs fatal and exits process with code 1 |
| DB connection lost mid-run (EC-02) | Pool handles internally; `healthCheck()` returns `'disconnected'`; no crash |
| Redis unreachable in `hybrid` mode (EC-03) | `syncTask` logs warning; skips cycle; continues; `healthCheck()` returns `'degraded'` |
| SIGTERM during active requests (EC-04) | `close-with-grace` drains in-flight within `SHUTDOWN_GRACE_MS`; teardown in order; exit 0 |
| `clusterClient` receives non-JSON `REDIS_CLUSTER_NODES` | Config loader catches this in Chunk 01; connector can assume it is valid JSON at this point |

---

## Risk Flags

- [ ] Risk: `ioredis.Cluster` has a different connection lifecycle than `ioredis.Redis`. Both must satisfy the same `RedisClientInterface`. The `teardown()` method on `clusterClient` calls `cluster.disconnect()` not `cluster.quit()` — verify the right method for clean shutdown without in-flight command loss.
- [ ] Risk: `syncTask.stop()` best-effort final sync has a 2 s timeout. This must be implemented with `Promise.race([finalSync, sleep(2000)])` and must not throw on timeout. Verify this does not leave dangling intervals.
- [ ] Risk: The integration test for graceful shutdown (`gracefulShutdown.test.ts`) is written now but will fully pass only after `app.ts` wiring in Chunk 07. The test must be structured so that skipped/pending assertions are explicit, not silently green.

---

## Definition of Done

- [ ] All acceptance criteria implemented
- [ ] All pre-written tests passing
- [ ] ESLint zero issues
- [ ] TypeScript strict mode zero errors
- [ ] Self-review checklist complete
- [ ] PR description written
- [ ] No TODO comments left in code
