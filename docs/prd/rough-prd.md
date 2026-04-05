# Rough PRD — Order splitting service (baseline platform)

## Intent

Build a **base application setup** for an **order splitting service**: accepts requests, runs calculations to split orders, and feeds a **downstream trading service** that executes in the share market.

## Performance expectation (from stakeholder)

- Handle on the order of **millions of requests per second** without **adding** latency (cross-cutting concerns should not dominate under pressure).
- **Core path** work should stay **sub-millisecond** so the system can sustain extreme throughput.

## Cross-cutting concerns (must be first-class, not bolted on poorly)

- Rate limiting  
- Security (authn/authz, abuse resistance)  
- Logging (+ metrics / tracing as needed)  
- Anything else typically “non-business” but required for production  

## Quality bar

- **Modular**, readable, maintainable.  
- **All levels** (intern → staff) should understand and extend the codebase.  

## Process

- Architecture and major decisions should be **cross-checked** with the stakeholder; stakeholder wants to **learn** the architecture, not receive a black box.

## Out of scope (initial guess — to be confirmed)

- Actual exchange connectivity, matching engine, or settlement (likely downstream).  
- Exact order-splitting business rules (to be specified).  
