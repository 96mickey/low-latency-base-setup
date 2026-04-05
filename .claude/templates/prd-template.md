# PRD: [Feature Name]

**Status:** Draft | Brainstormed | Final
**Author:**
**Date:**
**Version:** 1.0

---

## 1. Problem Statement

> What problem are we solving? Who has this problem? What is the cost of not solving it?

---

## 2. Goals

> What does success look like? Define 2-4 concrete, measurable goals.

- [ ] Goal 1 (measurable)
- [ ] Goal 2 (measurable)

## 3. Non-Goals

> What are we explicitly NOT doing in this iteration? Be specific.

- We are not building X
- We are not handling Y

---

## 4. Requirements

### 4.1 Functional Requirements

> Each requirement must be testable. Use "must", "must not", "should" with precision.

| ID | Requirement | Priority | Notes |
|----|-------------|----------|-------|
| FR-01 | | P0 | |
| FR-02 | | P1 | |

### 4.2 Non-Functional Requirements

| Category | Requirement | Target |
|----------|-------------|--------|
| Latency | p99 response time | < 200ms |
| Throughput | Requests per second | 100 rps |
| Availability | Uptime target | 99.9% |
| Security | Authentication | JWT / API Key |
| Data retention | Log retention | 30 days |

### 4.3 API Contract (if applicable)

```
METHOD /path

Request:
{
  "field": "type" // description
}

Response 200:
{
  "field": "type"
}

Response 400:
{
  "error": "string",
  "field": "string" // optional
}

Errors:
- 400: Validation failure
- 401: Unauthenticated
- 404: Resource not found
- 409: Conflict (e.g. idempotency key reuse)
- 500: Internal server error
```

---

## 5. Edge Cases

> Enumerate every edge case explicitly. If it is not listed here, it is not in scope.

| # | Scenario | Expected Behaviour |
|---|----------|--------------------|
| EC-01 | Empty input array | Return 400 with message "input must not be empty" |
| EC-02 | Duplicate request with same idempotency key | Return 409 |
| EC-03 | | |

---

## 6. Acceptance Criteria

> Binary, testable. Each criterion maps to at least one test case.

- [ ] AC-01: Given X, when Y, then Z
- [ ] AC-02:
- [ ] AC-03:

---

## 7. Security Considerations

- Authentication: [ required / not required ]
- Authorization: [ who can perform this action ]
- Input sanitization: [ what inputs need sanitizing ]
- Rate limiting: [ limit per IP / per user / per key ]
- Sensitive data: [ what must not be logged ]

---

## 8. Observability

- **Logs:** What events must be logged at what level?
- **Metrics:** What counters/gauges/histograms should be emitted?
- **Alerts:** What conditions should page someone?
- **Tracing:** Are distributed traces required?

---

## 9. Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| Redis | Optional | Used for idempotency store if available |
| | | |

---

## 10. Open Questions

> Questions that must be answered before or during planning. Each should have an owner and a resolution date.

| # | Question | Owner | Status |
|---|----------|-------|--------|
| Q-01 | | | Open |

---

## 11. Future Scope

> Things we are not building now but must not design ourselves into a corner on.

- Future feature 1: [brief description of how current design accommodates this]
- Future feature 2:

---

## Brainstorm Notes

> Added by brainstorming-agent. Do not delete.

### 🔴 Blockers
-

### 🟡 Important
-

### 🟢 Suggestions
-
