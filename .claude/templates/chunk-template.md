# Chunk [XX]: [Chunk Name]

**Status:** Planned | In Progress | In Review | Merged
**Depends on:** Chunk-XX, Chunk-XX (or "none")
**PRD References:** FR-01, FR-02, AC-01 (list the requirement IDs this chunk addresses)

---

## What This Chunk Delivers

> One paragraph. What can a user or system do after this chunk is merged that they could not do before?

---

## Explicit Scope

### In Scope
- [ ] Specific thing 1
- [ ] Specific thing 2

### Out of Scope
> Be explicit. Prevents scope creep during implementation.
- We are NOT building X in this chunk (covered in Chunk-YY)
- We are NOT adding authentication (covered in Chunk-ZZ)

---

## Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `src/routes/orders.ts` | Create | POST /orders handler |
| `src/services/order.service.ts` | Create | Business logic |
| `src/types/order.ts` | Create | Type definitions |
| `tests/unit/order.service.test.ts` | Create | Unit tests |
| `tests/integration/orders.test.ts` | Create | Integration tests |
| `src/app.ts` | Modify | Register new route |

---

## Data Model

```typescript
// Define any new types/interfaces introduced in this chunk
interface OrderInput {
  symbol: string;
  quantity: number;
  side: 'BUY' | 'SELL';
}

interface OrderResult {
  id: string;
  // ...
}
```

---

## API Contract

```
POST /orders
Headers:
  Content-Type: application/json
  Idempotency-Key: string (required)

Request Body:
{
  "symbol": "AAPL",
  "quantity": 100,
  "side": "BUY"
}

Response 201:
{
  "id": "uuid",
  "status": "accepted",
  "createdAt": "ISO8601"
}

Errors:
  400 — validation failure (invalid symbol, quantity ≤ 0, missing side)
  409 — idempotency key already used
  429 — rate limit exceeded
```

---

## Acceptance Criteria

> Each criterion must be binary (pass/fail) and directly testable.

- [ ] AC-01: POST /orders with valid body returns 201 with an order ID
- [ ] AC-02: POST /orders with missing `symbol` returns 400 with field name in error
- [ ] AC-03: POST /orders with quantity ≤ 0 returns 400
- [ ] AC-04: Two POSTs with the same Idempotency-Key return 409 on the second
- [ ] AC-05: Response time p99 < 100ms under 50 rps

---

## Performance Targets

| Metric | Target |
|--------|--------|
| p50 latency | < 20ms |
| p99 latency | < 100ms |
| Max concurrent requests | 50 |

---

## Security Requirements

- [ ] Idempotency-Key header validated (non-empty string, max 128 chars)
- [ ] All string inputs sanitized (no SQL injection vectors, though we use in-memory store)
- [ ] Rate limit: 100 requests/minute per IP

---

## Error Scenarios to Handle

| Scenario | Expected Response |
|----------|------------------|
| Missing required field | 400 `{ error: "field is required", field: "fieldName" }` |
| Invalid enum value | 400 with allowed values listed |
| Duplicate idempotency key | 409 `{ error: "duplicate request" }` |
| Internal error | 500 `{ error: "internal server error" }` — no stack trace exposed |

---

## Risk Flags

> Technical uncertainties or things that may require more investigation during implementation.

- [ ] Risk: In-memory idempotency store is not shared across instances — note this as a known limitation in comments
- [ ] Risk:

---

## Definition of Done

- [ ] All acceptance criteria implemented
- [ ] All pre-written tests passing
- [ ] Tests cover acceptance criteria; **≥ 95% coverage** is enforced in the **final PRD hardening pass** (not necessarily each chunk — see `CLAUDE.md`)
- [ ] ESLint zero issues
- [ ] TypeScript strict mode zero errors
- [ ] Self-review checklist complete
- [ ] PR description written
- [ ] No TODO comments left in code
