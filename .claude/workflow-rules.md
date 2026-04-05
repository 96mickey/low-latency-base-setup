# Workflow rules (enforcement layer)

Lightweight reference for **Technical Delivery Manager** and sub-agents. **Source of truth:** root `CLAUDE.md`.

---

## Execution pipeline (order)

1. Rough PRD → `docs/prd/rough-prd.md`  
2. **Phase 1** — `brainstorming-agent` → `docs/prd/final-prd.md`  
3. **Phase 2** — `technical-architect-agent` (planning / Q&A) → clarifications in PRD or `docs/decisions.md`  
4. **Phase 3** — `technical-architect-agent` (design) → `docs/technical-design.md`  
5. **Phase 4** — `planning-agent` → `docs/chunks/chunk-XX.md`  
6. **Phase 5** — `testing-agent` → tests in `tests/` only (**no** new `docs/**` spec files after Phase 4; see `CLAUDE.md` *Documentation authoring window*)  
7. **Phase 6** — `coding-agent` → `src/`, green tests, PR  
8. **Phase 7** — Chunk completion gate (+ optional `review-agent`)  
9. **Phase 8** — `coding-agent` — full suite, **≥95%** coverage (lines, branches, functions, statements)  

---

## Agent invocation order (default)

`brainstorming-agent` → `technical-architect-agent` (×2 phases) → `planning-agent` → `testing-agent` → `coding-agent` → [`review-agent`] → … next chunk … → final `coding-agent` (Phase 8).

**Never** run two agents as “parallel workstreams” on the same delivery unless the user explicitly opts into **Continuous Execution Mode** (see `CLAUDE.md`) — and even then, **dependencies** and **test/lint health** stay strict.

---

## Approval gates (explicit user phrases)

| Gate | User says |
|------|-----------|
| Final PRD | **"PRD finalized"** |
| Planning done | **"Planning complete"** |
| Design locked | **"Design approved"** |

If brainstorming exceeds **2 cycles** without **"PRD finalized"**, summarize open questions and wait for direction (`CLAUDE.md` Phase 1).

---

## DAR (Decision Approval Required)

If the change touches **architecture**, **new tools/infrastructure**, **security**, or **approved design deviations**:

1. **STOP** implementation and merging.  
2. Append an entry to `docs/decisions.md` (ADR or `.claude/templates/decision-log-template.md`).  
3. Proceed only after user **approval** (Status → Approved).

---

## Anti-patterns (disallowed)

- Parallel agents on the same feature  
- Code before tests (for chunk work)  
- Skipping approval gates  
- Silent scope creep vs chunk / PRD / design  
- Weakening tests without **testing-agent** / **planning-agent** alignment when failure is ambiguous  
- **Writing new specification docs under `docs/` after Phase 4** (except DAR append to `docs/decisions.md`)  

---

## Continuous execution mode

See `CLAUDE.md`. **Still required:** dependency order, passing tests/lint, full pipeline substance — only pauses between chunks and strict one-PR-per-chunk cadence may relax.
