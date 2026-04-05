# Chunk 05: Rate Limiting Middleware and Input Validation Middleware

**Status:** Planned
**Depends on:** Chunk 04
**PRD References:** FR-05, FR-09, AC-05, AC-06, AC-07, AC-08, EC-07, EC-08, EC-09, EC-10, EC-11

---

## What This Chunk Delivers

After this chunk is merged the server enforces the full three-layer rate limiting system (latency circuit breaker → new-IP limiter → per-IP token bucket) on every request, and all Zod-validated route schemas produce a standardised 400 error response on validation failure. The rate limiting layers are independently unit-testable pure state machines — no I/O on the hot path. CIDR bypass and global disable are both functional. The `rateLimitRejectedTotal` metric counter (defined in Chunk 04) is now incremented on each rejection.

---

## Explicit Scope

### In Scope
- [ ] `src/middleware/rateLimit/tokenBucket.ts` — per-IP LRU token bucket; `consumeToken(ip): { allowed: boolean; retryAfterSecs: number }` using lazy refill; `drainDeltas(): Map<string, number>` atomically snapshots and resets local delta counters; background sweep (60 s interval) evicting expired entries; uses `helpers/lruMap.ts`
- [ ] `src/middleware/rateLimit/newIpLimiter.ts` — sliding-window counter of unique new IPs/sec; `checkNewIp(ip: string, isNew: boolean): boolean` (true = allowed); caps at `RL_NEW_IP_RATE_MAX`; returns IPs in LRU as "returning" (bypass this layer)
- [ ] `src/middleware/rateLimit/latencyCircuitBreaker.ts` — ring buffer of recent request durations; EMA baseline; background `setInterval` every `LATENCY_CB_CHECK_INTERVAL_MS` recomputes p99 and drives `CLOSED → OPEN → HALF_OPEN → CLOSED` state machine; warmup suppression for `LATENCY_CB_WARMUP_MS`; `getState(): CircuitBreakerState`; `recordLatency(ms: number): void`; `start()` / `stop()` for the background interval
- [ ] `src/middleware/rateLimit/index.ts` — `onRequest` hook; extracts client IP via `helpers/ipExtractor`; checks bypass CIDR list via `helpers/cidrMatcher`; checks `RATE_LIMIT_DISABLED`; runs Layer 1a → Layer 1b → Layer 2 in order; returns 429 at first failed layer with `StandardErrorResponse` shape and `Retry-After` header; increments `rateLimitRejectedTotal` metric with correct `layer` label; exported as a Fastify plugin
- [ ] `src/connectors/redis/syncTask.ts` — MODIFY: replace the stub `getDeltas` function reference with the real `tokenBucket.drainDeltas()` reference (the `syncTask` was created in Chunk 02; the actual delta source is wired here)
- [ ] `src/middleware/validation/index.ts` — Zod schema compiler wrapper; `makeValidator(schema: ZodSchema)` returns a Fastify `preHandler` hook; on failure replies 400 with `StandardErrorResponse` shape and `error.code === 'VALIDATION_ERROR'`; on success attaches parsed data to `request.body` (or `request.params`, etc.); exported as a factory function
- [ ] Unit tests: tokenBucket (refill math, eviction, retryAfter, drainDeltas atomicity), newIpLimiter (window reset, returning-IP bypass, cap enforcement), latencyCircuitBreaker (state transitions, warmup suppression, EMA formula, ring buffer behaviour), rateLimit index (bypass CIDR, RATE_LIMIT_DISABLED, layer execution order, 429 shape), validation middleware (valid schema passes, invalid schema 400 with correct shape)
- [ ] Integration tests: per-IP bucket exhaustion → 429 + `Retry-After`; CIDR bypass; `RATE_LIMIT_DISABLED=true`; Layer 1b new-IP flood rejection; Zod validation failure → 400

### Out of Scope
- We are NOT creating the health route or controller — that is Chunk 06
- We are NOT creating `src/app.ts` or `src/index.ts` — that is Chunk 07
- We are NOT creating Docker Compose files — that is Chunk 07
- We are NOT testing the global latency circuit breaker with a real HTTP load in this chunk — the state machine is unit-tested; an end-to-end latency trip test is deferred to the integration test suite in Chunk 07

---

## Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `src/middleware/rateLimit/tokenBucket.ts` | Create | Per-IP LRU token bucket; drainDeltas(); background sweep |
| `src/middleware/rateLimit/newIpLimiter.ts` | Create | Sliding-window new-IP counter |
| `src/middleware/rateLimit/latencyCircuitBreaker.ts` | Create | Ring buffer; EMA; state machine; start/stop |
| `src/middleware/rateLimit/index.ts` | Create | onRequest hook; layer orchestration; 429 responses |
| `src/middleware/validation/index.ts` | Create | Zod preHandler factory; 400 StandardErrorResponse |
| `src/connectors/redis/syncTask.ts` | Modify | Wire tokenBucket.drainDeltas() as the delta source |
| `tests/unit/middleware/rateLimit/tokenBucket.test.ts` | Create | Refill math; eviction; retryAfter; drainDeltas |
| `tests/unit/middleware/rateLimit/newIpLimiter.test.ts` | Create | Window reset; cap; returning-IP bypass |
| `tests/unit/middleware/rateLimit/latencyCircuitBreaker.test.ts` | Create | All state transitions; warmup; EMA; ring buffer |
| `tests/unit/middleware/rateLimit/index.test.ts` | Create | Bypass CIDR; RATE_LIMIT_DISABLED; layer order; 429 shape |
| `tests/unit/middleware/validation.test.ts` | Create | Valid passes; invalid 400; error shape |
| `tests/integration/rateLimit.test.ts` | Create | Full HTTP integration: bucket exhaustion; bypass; disabled; new-IP flood |

---

## Data Model

```typescript
// tokenBucket — internal entry shape (matches RateLimitBucketEntry from types/index.ts)
interface RateLimitBucketEntry {
  tokens: number;
  lastRefillMs: number;
  localDelta: number; // accumulated since last drainDeltas() call
}

// tokenBucket public interface
interface TokenBucket {
  consumeToken(ip: string): { allowed: boolean; retryAfterSecs: number };
  drainDeltas(): Map<string, number>; // atomic snapshot + reset
}

// latencyCircuitBreaker public interface
interface LatencyCircuitBreaker {
  getState(): CircuitBreakerState;
  recordLatency(ms: number): void;
  start(): void;  // starts background interval
  stop(): void;   // clears background interval
}

// newIpLimiter public interface
interface NewIpLimiter {
  isNewIp(ip: string): boolean;        // checks LRU presence; true = IP is new
  checkAndRecord(ip: string): boolean; // returns true (allowed) or false (rejected)
}

// validation middleware factory
function makeValidator<T>(schema: ZodSchema<T>): preHandlerHookHandler;
```

---

## API Contract

No new application HTTP endpoints in this chunk.

Error response on per-IP rate limit exceeded:
```
HTTP/1.1 429 Too Many Requests
Retry-After: 10
X-Correlation-Id: <uuid>
Content-Type: application/json

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests from this IP. Please retry after 10 seconds.",
    "statusCode": 429,
    "correlationId": "<uuid>"
  }
}
```

Error response on Zod validation failure:
```
HTTP/1.1 400 Bad Request
X-Correlation-Id: <uuid>
Content-Type: application/json

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed: body.email is required; body.quantity must be a positive number.",
    "statusCode": 400,
    "correlationId": "<uuid>"
  }
}
```

---

## Acceptance Criteria

- [ ] AC-C05-01: `tokenBucket.consumeToken(ip)` with a full bucket returns `{ allowed: true }` and decrements the token count
- [ ] AC-C05-02: `tokenBucket.consumeToken(ip)` with zero tokens returns `{ allowed: false, retryAfterSecs: N }` where N = `ceil(1 / RL_IP_REFILL_RATE)`
- [ ] AC-C05-03: Token refill is lazy — tokens are added proportional to elapsed time since `lastRefillMs`, capped at `RL_IP_MAX_TOKENS`
- [ ] AC-C05-04: `tokenBucket.drainDeltas()` returns the accumulated delta Map and resets all local deltas to zero atomically (single-threaded Node.js guarantee)
- [ ] AC-C05-05: When the LRU Map reaches `RL_MAX_IPS` capacity, adding a new IP evicts the least-recently-used entry
- [ ] AC-C05-06: `newIpLimiter.checkAndRecord(ip)` returns `true` for a new IP when new-IP rate is below `RL_NEW_IP_RATE_MAX`; returns `false` when the cap is exceeded
- [ ] AC-C05-07: An IP already present in the token bucket LRU Map bypasses the new-IP limiter entirely (is treated as "returning")
- [ ] AC-C05-08: `latencyCircuitBreaker` starts in `CLOSED` state; transitions to `OPEN` when p99 exceeds `EMA_baseline + LATENCY_CB_DELTA_MS` after warmup; transitions to `HALF_OPEN` after `LATENCY_CB_RECOVERY_MS`; returns to `CLOSED` on a healthy probe
- [ ] AC-C05-09: No circuit breaker trips occur during the `LATENCY_CB_WARMUP_MS` period regardless of observed latency
- [ ] AC-C05-10: A request from an IP in `RATE_LIMIT_BYPASS_CIDRS` skips all three rate limit layers and proceeds to the route handler
- [ ] AC-C05-11: `RATE_LIMIT_DISABLED=true` makes all rate limit layers a passthrough no-op; `rateLimitRejectedTotal` counter remains at zero
- [ ] AC-C05-12: Rate limit rejection response is `429` with `error.code === 'RATE_LIMIT_EXCEEDED'` and a `Retry-After` header
- [ ] AC-C05-13: `makeValidator(zodSchema)` returns a hook that passes valid input through and replies 400 with `error.code === 'VALIDATION_ERROR'` on invalid input
- [ ] AC-C05-14: `rateLimitRejectedTotal` metric is incremented with the correct `layer` label (`ip`, `new_ip`, or `global`) on each rejection
- [ ] AC-C05-15: All unit and integration tests for this chunk pass

---

## Performance Targets

| Metric | Target |
|--------|--------|
| `tokenBucket.consumeToken()` hot-path cost | O(1) LRU Map lookup + arithmetic; zero I/O |
| `latencyCircuitBreaker.getState()` | Single atomic read; zero computation on hot path |
| `rateLimit/index.ts` total onRequest cost | Zero I/O; pure in-memory operations; contributes < 0.2 ms of the 1 ms p99 budget |

---

## Security Requirements

- [ ] The CIDR bypass check must execute before any rate limiting layer; a matching IP must never be rate-limited regardless of config values
- [ ] `RATE_LIMIT_BYPASS_CIDRS` must be pre-compiled at startup (in Chunk 01's `cidrMatcher.compileCidrs()`) — not re-parsed on every request
- [ ] `Retry-After` header value must be a positive integer (seconds); it must not reveal internal token bucket state beyond the retry delay
- [ ] The `layer` label on `rateLimitRejectedTotal` must use a fixed enum of values; it must never include the client IP or request content

---

## Error Scenarios to Handle

| Scenario | Expected Behaviour |
|----------|-------------------|
| Per-IP token bucket exhausted (EC-07) | 429 with `Retry-After` header; `rateLimitRejectedTotal{layer="ip"}` incremented |
| Global latency circuit breaker open (EC-08) | 429 with `Retry-After: 5` (or `LATENCY_CB_RECOVERY_MS / 1000`); `rateLimitRejectedTotal{layer="global"}` incremented |
| New-IP rate cap exceeded (Layer 1b) | 429; `rateLimitRejectedTotal{layer="new_ip"}` incremented |
| Request from bypass CIDR (EC-10) | All layers skipped; no counter incremented |
| `RATE_LIMIT_DISABLED=true` (EC-11) | All layers no-op; all counters remain zero |
| Zod validation fails (EC-09) | 400 with `VALIDATION_ERROR`; human-readable field path in message |
| `tokenBucket` background sweep takes > 1 s | No impact on request handling — sweep runs in the same event-loop tick as non-blocking iteration; capped LRU ensures bounded iteration time |

---

## Risk Flags

- [ ] Risk: The latency circuit breaker's background interval (`LATENCY_CB_CHECK_INTERVAL_MS`) must be stopped cleanly during graceful shutdown. `latencyCircuitBreaker.stop()` must be called in the teardown sequence. This is wired in Chunk 07's `app.ts` — note this dependency explicitly and ensure `stop()` is exported.
- [ ] Risk: `tokenBucket.drainDeltas()` is called by `syncTask` (Chunk 02 modification). The modification to `syncTask.ts` in this chunk introduces a circular module concern if not structured carefully. `tokenBucket` must export a `drainDeltas` function that `syncTask` accepts as an injected dependency (not a direct import) to avoid circular references.
- [ ] Risk: Ring buffer size `LATENCY_CB_WINDOW_SIZE` defaults to 10 000. At 10k+ RPS per instance, the ring buffer fills in < 1 s. The p99 computation from a 10k-element ring buffer must complete in well under 1 ms — a simple linear sort of 10k numbers takes ~2 ms. Implement with a pre-sorted insertion or approximate p99 (e.g. reservoir sampling) if linear sort proves too slow. Flag for implementation validation.

---

## Definition of Done

- [ ] All acceptance criteria implemented
- [ ] All pre-written tests passing
- [ ] ESLint zero issues
- [ ] TypeScript strict mode zero errors
- [ ] Self-review checklist complete
- [ ] PR description written
- [ ] No TODO comments left in code
