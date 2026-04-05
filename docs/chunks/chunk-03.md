# Chunk 03: Security Middleware and Correlation ID Middleware

**Status:** Planned
**Depends on:** Chunk 02
**PRD References:** FR-04, FR-11, AC-09, AC-10, EC-06

---

## What This Chunk Delivers

After this chunk is merged every HTTP request through the Fastify instance passes through security headers (`@fastify/helmet`), CORS enforcement, body-size limiting, and correlation ID injection/propagation. These are the two lowest-risk, highest-value middleware layers: they have zero external I/O on the hot path and are prerequisites for every subsequent middleware and route. A reviewer can inspect and verify each layer independently before rate limiting (Chunk 05) is added.

---

## Explicit Scope

### In Scope
- [ ] `src/middleware/security/index.ts` — registers `@fastify/helmet` with default options; registers `@fastify/cors` with `CORS_ALLOWED_ORIGINS` allowlist (comma-split, exact match); registers Fastify body size limit via `addContentTypeParser` or `fastify.addHook` enforcing `BODY_SIZE_LIMIT`; returns a Fastify plugin
- [ ] `src/middleware/correlationId/index.ts` — `onRequest` hook: reads `X-Correlation-Id` header or calls `generateUuid()`; attaches `request.correlationId`; creates Pino child logger bound with `{ correlationId }`; `onSend` hook: sets `X-Correlation-Id` response header; exported as a Fastify plugin
- [ ] `src/middleware/tracingSlot/index.ts` — no-op `onRequest` hook registered as placeholder for future OpenTelemetry; zero overhead in v1; exported as a Fastify plugin
- [ ] TypeScript declaration merging (or `FastifyRequest` interface augmentation) so that `request.correlationId: string` is a typed field without unsafe casting
- [ ] Unit tests for security plugin (configuration correctness) and correlation ID middleware (header read, UUID generation, child logger binding, response header injection)
- [ ] Integration test for body-size limit (`EC-06`): request body exceeding `BODY_SIZE_LIMIT` returns 413 with `StandardErrorResponse` shape

### Out of Scope
- We are NOT adding rate limiting (`src/middleware/rateLimit/`) — that is Chunk 05
- We are NOT adding input validation middleware (`src/middleware/validation/`) — that is Chunk 05
- We are NOT adding the observability module (logger config, metrics definitions) — that is Chunk 04
- We are NOT registering routes or controllers — those come in Chunk 06
- We are NOT writing `src/app.ts` or `src/index.ts` — that is Chunk 07

---

## Files to Create / Modify

| File | Action | Notes |
|------|--------|-------|
| `src/middleware/security/index.ts` | Create | Helmet + CORS + body limit plugin |
| `src/middleware/correlationId/index.ts` | Create | onRequest + onSend hooks; request augmentation |
| `src/middleware/tracingSlot/index.ts` | Create | No-op plugin; OpenTelemetry placeholder |
| `src/types/index.ts` | Modify | Add `FastifyRequest` interface augmentation for `correlationId` field |
| `tests/unit/middleware/correlationId.test.ts` | Create | Header read; UUID fallback; child logger binding; onSend header |
| `tests/unit/middleware/security.test.ts` | Create | Plugin configuration shape; CORS origin list parsed correctly |
| `tests/integration/security.test.ts` | Create | Body > BODY_SIZE_LIMIT → 413 with StandardErrorResponse shape |

---

## Data Model

```typescript
// FastifyRequest augmentation (added to src/types/index.ts)
declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

// Security plugin options (internal; not exported as a public type)
interface SecurityPluginOptions {
  corsAllowedOrigins: string[]; // parsed from config.CORS_ALLOWED_ORIGINS
  bodySizeLimit: string;        // e.g. '100kb' — passed directly to Fastify addHook
}
```

---

## API Contract

No new application HTTP endpoints in this chunk.

Response headers added to every response after this chunk:
```
X-Correlation-Id: <uuid-v4>
Content-Security-Policy: default-src 'self'
X-Frame-Options: SAMEORIGIN
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=15552000; includeSubDomains
Referrer-Policy: no-referrer
(+ other Helmet defaults)
```

Error response when body exceeds limit:
```
HTTP/1.1 413 Payload Too Large
Content-Type: application/json
X-Correlation-Id: <uuid>

{
  "error": {
    "code": "PAYLOAD_TOO_LARGE",
    "message": "Request body exceeds the configured limit of 100kb.",
    "statusCode": 413,
    "correlationId": "<uuid>"
  }
}
```

---

## Acceptance Criteria

- [ ] AC-C03-01: All responses include `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Strict-Transport-Security` header (verifies Helmet is active)
- [ ] AC-C03-02: A request with `Origin` in `CORS_ALLOWED_ORIGINS` receives a correct `Access-Control-Allow-Origin` response header
- [ ] AC-C03-03: A request with `Origin` NOT in `CORS_ALLOWED_ORIGINS` does not receive `Access-Control-Allow-Origin` header (CORS rejection)
- [ ] AC-C03-04: A request body exceeding `BODY_SIZE_LIMIT` returns 413 with `error.code === 'PAYLOAD_TOO_LARGE'` and the `StandardErrorResponse` shape
- [ ] AC-C03-05: A request carrying `X-Correlation-Id: my-trace-id` receives the same value back in the response `X-Correlation-Id` header
- [ ] AC-C03-06: A request with no `X-Correlation-Id` header receives a UUID v4 value in the response `X-Correlation-Id` header
- [ ] AC-C03-07: `request.correlationId` is set before any downstream hook or handler runs (verified by asserting the value exists in a test hook registered after correlationId middleware)
- [ ] AC-C03-08: The tracing slot middleware registers without error and adds zero measurable latency (verified by: server starts, no error thrown on registration)
- [ ] AC-C03-09: All unit and integration tests in this chunk pass (`npm run test:unit && npm run test:integration` scoped to security and correlationId)

---

## Performance Targets

| Metric | Target |
|--------|--------|
| `correlationId` middleware hot-path cost | Zero I/O; one `crypto.randomUUID()` call or one header read — negligible |
| `security` middleware cost | Helmet and CORS are response-header operations only — negligible on the critical path |
| Body size enforcement | Enforced before body parsing completes — no full-body buffering of oversized requests |

---

## Security Requirements

- [ ] CORS `origin` option must use an exact-match allowlist derived from `CORS_ALLOWED_ORIGINS`; wildcard `*` must never be set unless explicitly configured
- [ ] Body size limit must be enforced before any route handler processes the body; reject at the transport layer, not after parsing
- [ ] `X-Correlation-Id` received from the client must be validated as a non-empty string before echo; if invalid (e.g. excessively long, non-printable chars) generate a fresh UUID instead
- [ ] Helmet must be configured with its secure defaults; no Helmet option must be explicitly disabled in this chunk

---

## Error Scenarios to Handle

| Scenario | Expected Behaviour |
|----------|-------------------|
| Request body exceeds `BODY_SIZE_LIMIT` (EC-06) | 413 with `PAYLOAD_TOO_LARGE` code; `StandardErrorResponse` shape; `X-Correlation-Id` set |
| `CORS_ALLOWED_ORIGINS` is empty or not set | `loadConfig()` in Chunk 01 catches this at startup — never reaches this middleware |
| `X-Correlation-Id` header value is 1024 characters | Generate a fresh UUID; do not echo the oversized value |
| Request to unknown route | Fastify default 404 handler fires; correlation ID and Helmet headers still present |

---

## Risk Flags

- [ ] Risk: Fastify's body size limit is set via `bodyLimit` in Fastify options (server-level) or per-route. The security plugin must enforce it at the server level so it applies universally. Verify the 413 response goes through the global error handler and produces `StandardErrorResponse` shape rather than Fastify's raw error format.
- [ ] Risk: `@fastify/cors` and `@fastify/helmet` must be registered in the correct plugin order. Helmet must register before CORS to avoid header conflicts. Verify actual header output in tests.

---

## Definition of Done

- [ ] All acceptance criteria implemented
- [ ] All pre-written tests passing
- [ ] ESLint zero issues
- [ ] TypeScript strict mode zero errors
- [ ] Self-review checklist complete
- [ ] PR description written
- [ ] No TODO comments left in code
