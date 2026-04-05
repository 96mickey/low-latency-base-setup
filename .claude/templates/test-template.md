# Test Plan: Chunk [XX] — [Chunk Name]

**Chunk:** `docs/chunks/chunk-XX.md`  
**PRD:** `docs/prd/final-prd.md`  

> Use this template for **what** to test. For a full matrix + handoff doc, also write `docs/chunks/chunk-XX-tests.md` (see `test-spec-template.md`).

---

## 1. Test categories

| Category | Scope |
|----------|--------|
| Unit | Pure logic, no I/O; fast |
| Integration | HTTP, plugins, in-process deps |
| Edge cases | Boundaries, empty/max inputs |
| Failure | Timeouts, downstream errors, invalid state |
| Concurrency / races | Shared state, parallel requests (if applicable) |
| Performance | p99 / throughput where chunk defines targets |
| Security | Auth failure, injection, error leakage |

---

## 2. Edge cases (checklist)

- [ ] Empty / null / missing required fields  
- [ ] Max size / rate limits  
- [ ] Duplicate requests / idempotency (if required)  
- [ ] Clock skew / ordering (if applicable)  

---

## 3. Failure scenarios (checklist)

- [ ] Validation errors → correct status + body shape  
- [ ] Dependency unavailable → defined behaviour  
- [ ] Internal error → no sensitive data in response  

---

## 4. Mapping to acceptance criteria

| AC ID | Test file(s) | Notes |
|-------|----------------|-------|

---

## 5. Explicitly not tested (this chunk)

> Document gaps so they are intentional.

---

## 6. Pending / `it.todo`

> Infrastructure or future chunks only.
