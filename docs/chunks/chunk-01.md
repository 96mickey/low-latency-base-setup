# Chunk 01: Project Scaffold, TypeScript Config, ESLint, Types, Utils, Helpers

**Status:** Planned
**Depends on:** none
**PRD References:** FR-10, AC-13, AC-15 (partial — linting/TS gate), NFR readability (≤150 lines/file)

---

## What This Chunk Delivers

After this chunk is merged the repository has a fully compilable, lintable TypeScript project skeleton. Every shared pure-code module is in place: all TypeScript interfaces (types), all stateless utility functions (utils), all domain-level shared helpers (lruMap, cidrMatcher, ipExtractor, retry), and the Zod-validated config loader. No server starts, no I/O happens, but every subsequent chunk can import from these modules without modification.

---

## Explicit Scope

### In Scope
- [ ] `package.json` — all runtime and dev dependencies declared; `build`, `lint`, `test`, `typecheck` scripts wired
- [ ] `tsconfig.json` — `"strict": true`; `outDir: dist`; path aliases if used
- [ ] `.eslintrc.cjs` — `eslint-config-airbnb-base` + `@typescript-eslint` overlay; `import/prefer-default-export` off
- [ ] `.env.example` — all 38 env vars listed with default values and descriptions; `.gitignore` entry for `.env.local`
- [ ] `vitest.config.ts` — sequential execution (`--pool=forks --poolOptions.forks.singleFork=true`); `coverage.provider: 'v8'`; `SCAFFOLD_DEPTH` guard env var set in setup
- [ ] `src/types/index.ts` — `Config`, `ConnectorInterface`, `RedisClientInterface`, `RateLimitBucketEntry`, `HealthResponse`, `StandardErrorResponse`, `RedisMode`, `RedisTopology`, `CircuitBreakerState` — zero runtime code
- [ ] `src/utils/uuid.ts` — `generateUuid()` using `crypto.randomUUID()`
- [ ] `src/utils/time.ts` — `nowMs()` (alias for `Date.now()`), `sleep(ms)` (promisified `setTimeout`)
- [ ] `src/helpers/lruMap.ts` — generic LRU Map; `get()`, `set()`, `has()`, `delete()`, `size` with O(1) eviction at cap
- [ ] `src/helpers/cidrMatcher.ts` — bitwise CIDR/IP membership check; `compileCidrs(list: string[])` returns a matcher function; no external library
- [ ] `src/helpers/ipExtractor.ts` — `extractClientIp(xff: string | undefined, requestIp: string, depth: number): string`; handles missing header, spoofing-depth offset
- [ ] `src/helpers/retry.ts` — `withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T>`; exponential backoff + jitter; configurable `maxRetries` and `baseMs`
- [ ] `src/config/index.ts` — Zod schema for all 38 env vars; `loadConfig()` collects all errors then throws with numbered human-readable list; returns typed `Config` object; never logs env values; Redis vars conditional via `superRefine`
- [ ] Unit tests for every module in this chunk (see test surface below)

### Out of Scope
- We are NOT creating the Fastify server or any HTTP listener (Chunk 02)
- We are NOT creating connectors for Postgres or Redis (Chunk 02)
- We are NOT creating middleware, routes, or controllers (Chunks 03–06)
- We are NOT creating observability modules (Chunk 04)
- We are NOT creating Docker Compose files (Chunk 07)
- We are NOT building `src/app.ts` or `src/index.ts` (Chunk 07)

---

## Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `package.json` | Create | All deps; scripts: build, lint, typecheck, test, test:unit, test:integration |
| `tsconfig.json` | Create | strict mode; Node 20 target; outDir: dist |
| `.eslintrc.cjs` | Create | airbnb-base + @typescript-eslint; no import/prefer-default-export |
| `.env.example` | Create | All 38 env vars with defaults and inline comments |
| `.gitignore` | Create | node_modules, dist, .env.local, tests/coverage |
| `vitest.config.ts` | Create | Sequential pool; v8 coverage; SCAFFOLD_DEPTH guard |
| `src/types/index.ts` | Create | All shared interfaces; zero runtime code |
| `src/utils/uuid.ts` | Create | generateUuid() |
| `src/utils/time.ts` | Create | nowMs(), sleep() |
| `src/helpers/lruMap.ts` | Create | Generic O(1) LRU Map |
| `src/helpers/cidrMatcher.ts` | Create | Bitwise CIDR matcher; no external dep |
| `src/helpers/ipExtractor.ts` | Create | XFF parser with depth offset |
| `src/helpers/retry.ts` | Create | withRetry with exponential backoff + jitter |
| `src/config/index.ts` | Create | Zod env loader; crash-fast; all-errors collection |
| `tests/unit/utils/uuid.test.ts` | Create | UUID format, uniqueness |
| `tests/unit/utils/time.test.ts` | Create | nowMs monotonicity, sleep duration |
| `tests/unit/helpers/lruMap.test.ts` | Create | get/set/has/eviction/size |
| `tests/unit/helpers/cidrMatcher.test.ts` | Create | IPv4 CIDR match/no-match; edge cases |
| `tests/unit/helpers/ipExtractor.test.ts` | Create | XFF parsing; depth; spoofing; fallback |
| `tests/unit/helpers/retry.test.ts` | Create | Retry count; backoff timing; jitter range; success on nth attempt |
| `tests/unit/config/config.test.ts` | Create | Valid config; missing required vars; all-errors listed; conditional Redis validation |

---

## Data Model

```typescript
// src/types/index.ts (complete interface list)
type RedisMode = 'local' | 'hybrid' | 'redis-primary';
type RedisTopology = 'standalone' | 'cluster';
type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface Config {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  HOST: string;
  METRICS_PORT: number;
  SHUTDOWN_GRACE_MS: number;
  LOG_LEVEL: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  DB_HOST: string;
  DB_PORT: number;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_SSL: boolean;
  DB_POOL_MIN: number;
  DB_POOL_MAX: number;
  DB_CONNECT_MAX_RETRIES: number;
  DB_CONNECT_RETRY_BASE_MS: number;
  REDIS_MODE: RedisMode;
  REDIS_TOPOLOGY: RedisTopology;
  REDIS_HOST?: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  REDIS_DB: number;
  REDIS_CLUSTER_NODES?: Array<{ host: string; port: number }>;
  REDIS_SYNC_INTERVAL_MS: number;
  RATE_LIMIT_DISABLED: boolean;
  RATE_LIMIT_BYPASS_CIDRS?: string;
  RL_IP_MAX_TOKENS: number;
  RL_IP_REFILL_RATE: number;
  RL_MAX_IPS: number;
  RL_NEW_IP_RATE_MAX: number;
  LATENCY_CB_DELTA_MS: number;
  LATENCY_CB_WINDOW_SIZE: number;
  LATENCY_CB_CHECK_INTERVAL_MS: number;
  LATENCY_CB_RECOVERY_MS: number;
  LATENCY_CB_WARMUP_MS: number;
  CORS_ALLOWED_ORIGINS: string;
  BODY_SIZE_LIMIT: string;
  TRUSTED_PROXY_DEPTH: number;
}

interface ConnectorInterface {
  connect(): Promise<void>;
  healthCheck(): Promise<string>;
  teardown(): Promise<void>;
}

interface RedisClientInterface extends ConnectorInterface {
  healthCheck(): Promise<'connected' | 'degraded'>;
  pipeline(): unknown; // RedisPipeline
  get(key: string): Promise<string | null>;
}

interface RateLimitBucketEntry {
  tokens: number;
  lastRefillMs: number;
  localDelta: number; // accumulated delta for hybrid sync
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  uptime: number;
  db: 'connected' | 'disconnected';
  redis: 'connected' | 'degraded';
  timestamp: string;
}

interface StandardErrorResponse {
  error: {
    code: string;
    message: string;
    statusCode: number;
    correlationId: string;
  };
}

interface RetryOptions {
  maxRetries: number;
  baseMs: number;
  maxMs?: number;
}
```

---

## API Contract

No HTTP endpoints in this chunk. This chunk delivers library code only.

---

## Acceptance Criteria

- [ ] AC-C01-01: `npm run typecheck` exits 0 with zero TypeScript errors
- [ ] AC-C01-02: `npm run lint` exits 0 with zero ESLint warnings or errors
- [ ] AC-C01-03: `loadConfig()` with all required vars present returns a correctly typed `Config` object
- [ ] AC-C01-04: `loadConfig()` with two missing required vars throws and the error message lists both missing vars by name
- [ ] AC-C01-05: `loadConfig()` with `REDIS_MODE=hybrid` and `REDIS_TOPOLOGY=standalone` but missing `REDIS_HOST` throws with `REDIS_HOST` in the error list
- [ ] AC-C01-06: `loadConfig()` with `REDIS_MODE=local` and `REDIS_HOST` absent does NOT throw (Redis vars are not required in local mode)
- [ ] AC-C01-07: `lruMap.set()` at capacity evicts the least-recently-used entry, not a random one; `size` reflects the cap
- [ ] AC-C01-08: `cidrMatcher` correctly identifies an IP inside and outside a `10.0.0.0/8` block; correctly handles `/32` and `/0`
- [ ] AC-C01-09: `ipExtractor` with `X-Forwarded-For: 1.2.3.4, 10.0.0.1` and `TRUSTED_PROXY_DEPTH=1` returns `1.2.3.4`
- [ ] AC-C01-10: `withRetry` calls the function up to `maxRetries` times on failure, then throws; succeeds and returns on the first success
- [ ] AC-C01-11: `generateUuid()` returns a string matching UUID v4 format; two calls return different values
- [ ] AC-C01-12: All unit tests pass (`npm run test:unit`)

---

## Performance Targets

| Metric | Target |
|--------|--------|
| `loadConfig()` execution time | < 50 ms (Zod parse is synchronous; this is startup-only) |
| `lruMap.get()` / `lruMap.set()` | O(1) — enforced by implementation review, not a latency test |
| `cidrMatcher` pre-compiled lookup | O(n) over bypass list; list is small (2–5 entries in practice) |

---

## Security Requirements

- [ ] `loadConfig()` must never log env variable values; it may log only the names of missing/invalid vars
- [ ] `DB_PASSWORD` and `REDIS_PASSWORD` must be typed as `string` in `Config` but must never appear in any log or error message produced by the config loader
- [ ] `cidrMatcher` must use bitwise arithmetic only — no `eval`, no regex on IP strings

---

## Error Scenarios to Handle

| Scenario | Expected Behaviour |
|----------|-------------------|
| All required vars missing | `loadConfig()` throws listing every missing var by name, numbered |
| Partial missing vars | Same — all missing collected before throwing, not fail-fast on first |
| `REDIS_CLUSTER_NODES` is not valid JSON | `loadConfig()` throws with a message identifying the var and parse failure |
| `withRetry` function throws on every attempt | Throws after `maxRetries` with the last error |
| `ipExtractor` receives an empty `X-Forwarded-For` string | Falls back to `requestIp` |
| `lruMap.get()` on absent key | Returns `undefined` without error |

---

## Risk Flags

- [ ] Risk: `cidrMatcher` must handle IPv4 only in v1 (IPv6 is out of scope). This must be documented with a clear comment in the implementation; no silent failure on IPv6 input.
- [ ] Risk: The `SCAFFOLD_DEPTH` guard in `vitest.config.ts` is critical (see memory). The setup file must set `process.env.SCAFFOLD_DEPTH = '1'` and any test that spawns child processes must check it before doing so.

---

## Definition of Done

- [ ] All acceptance criteria implemented
- [ ] All pre-written tests passing
- [ ] ESLint zero issues
- [ ] TypeScript strict mode zero errors
- [ ] Self-review checklist complete
- [ ] PR description written
- [ ] No TODO comments left in code
