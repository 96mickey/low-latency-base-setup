# Technical Design: [Feature / System]

**Status:** Draft | In Review | Approved  
**PRD:** `docs/prd/final-prd.md`  
**Date:**  
**Author:**

---

## 1. Architecture (logical)

> Components, boundaries, and trust zones. ASCII or bullet diagram is fine.

```
[Client] → [API] → [Domain] → [Persistence]
```

---

## 2. API contracts

> Routes, payloads, status codes, idempotency, auth. Link to OpenAPI snippet or tables.

| Method | Path | Auth | Request | Success | Errors |
|--------|------|------|---------|---------|--------|

---

## 3. Data model & persistence

> Entities, schema, indexes, retention, migrations strategy (if any).

---

## 4. Data flow

> Request path, async boundaries, events, batch jobs.

---

## 5. Failure handling

> Timeouts, retries, circuit breakers, degraded modes, user-visible errors.

---

## 6. Concurrency

> Shared state, locks, SAB/cluster notes, race-prone areas.

---

## 7. Performance

> p99 / throughput targets, hot paths, caching.

---

## 8. Security

> AuthN/Z, secrets, validation, rate limits, logging redaction.

---

## 9. Out of scope (this design)

> Explicit non-goals to prevent creep.

---

## 10. Open questions

> Must be empty or resolved before **"Design approved"**.
