# Test Spec: Chunk [XX] — [Chunk Name]

> **Template only — do not commit to `docs/chunks/`.** Per `CLAUDE.md`, specification docs are authored only through Phase 4; encode the matrix in `tests/` (and optional PR description). Use `.claude/templates/test-template.md` as a shorter checklist.

**Written by:** testing-agent
**Chunk:** `docs/chunks/chunk-XX.md`
**Test files:**
- `tests/unit/[module].test.ts`
- `tests/integration/[endpoint].test.ts`

---

## Coverage Target

| Metric | Target |
|--------|--------|
| Lines / branches / functions / statements | Meaningful tests required each chunk; **≥ 95%** enforced only in the **final PRD hardening pass** (see `CLAUDE.md`) |

---

## Test Matrix

### Unit Tests — `[ModuleName]`

| # | Test Name | Category | Input | Expected Output | AC Reference |
|---|-----------|----------|-------|-----------------|-------------|
| U-01 | should split order proportionally across symbols | Happy path | valid weights summing to 1 | correctly split quantities | AC-01 |
| U-02 | should throw ValidationError when weights do not sum to 1 | Validation | weights [0.5, 0.6] | throw ValidationError | AC-02 |
| U-03 | should handle single-symbol order | Edge case | one symbol, weight 1.0 | full quantity on that symbol | AC-01 |
| U-04 | should round fractional shares correctly | Edge case | quantity 100, weight 0.333 | 33 shares, not 33.33 | AC-03 |
| U-05 | should return zero allocation for zero weight | Edge case | one symbol with weight 0 | 0 shares allocated | AC-01 |

### Integration Tests — `POST /orders`

| # | Test Name | Category | Setup | Request | Expected Response | AC Reference |
|---|-----------|----------|-------|---------|------------------|-------------|
| I-01 | should return 201 with order on valid request | Happy path | — | valid body + idempotency key | 201, body contains id | AC-01 |
| I-02 | should return 400 when symbol is missing | Validation | — | body without symbol | 400, error.field = "symbol" | AC-02 |
| I-03 | should return 400 when quantity is zero | Validation | — | quantity: 0 | 400 | AC-02 |
| I-04 | should return 400 when quantity is negative | Validation | — | quantity: -1 | 400 | AC-02 |
| I-05 | should return 400 when side is invalid enum | Validation | — | side: "HOLD" | 400 with allowed values | AC-02 |
| I-06 | should return 409 on duplicate idempotency key | Idempotency | first request succeeds | same key, same body | 409 | AC-04 |
| I-07 | should return 409 on duplicate key with different body | Idempotency | first request succeeds | same key, different body | 409 | AC-04 |
| I-08 | should handle 50 concurrent requests without data corruption | Concurrency | — | 50 parallel requests, unique keys | all 201, no shared state leakage | AC-05 |
| I-09 | should reject request without Idempotency-Key header | Validation | — | no header | 400 | AC-04 |
| I-10 | should reject Idempotency-Key longer than 128 chars | Validation | — | key = 129 char string | 400 | AC-04 |
| I-11 | should not expose stack trace in 500 error body | Security | handler that throws | trigger error | 500 body has no stack | — |
| I-12 | should return 429 after exceeding rate limit | Rate limiting | — | 101 requests in 60s | 101st returns 429 | — |

---

## Test Assumptions

> Things the tests assume about the environment. The coding-agent must ensure these hold.

- Unit tests: No I/O, no HTTP, no timers (mock if needed)
- Integration tests: App runs with in-memory store (no Redis required)
- All tests: `beforeEach` resets shared state — tests are order-independent
- Concurrency tests: Use `Promise.all` with real async timing, not fake timers

---

## Intentionally Not Tested

> Things out of scope for this chunk's tests. Document so no one wastes time looking for these tests.

- Redis failover behaviour — covered in Chunk-XX
- Authentication — not required for this endpoint per PRD
- Load testing at production scale — infrastructure test, not unit/integration

---

## Pending / Todo Tests

> Tests that cannot be written yet due to missing infrastructure or dependencies.

```typescript
it.todo('should emit metrics counter on successful order creation') // requires metrics setup in Chunk-XX
it.todo('should recover gracefully when idempotency store is unavailable') // requires Redis mock in Chunk-XX
```

---

## Notes for Coding-Agent

- The concurrency test (I-08) is intentionally strict. If it fails due to a race condition, that is a real bug — do not weaken the test.
- I-07 (same key, different body) must return 409. The system does not need to validate body equality — the key alone determines idempotency.
- Error response shape must be exactly `{ error: string, field?: string }` — the integration tests assert on shape, not just status code.
