# TrueStack — Agent Instructions

TrueStack is an agentic AI-powered research platform that helps developers make
informed technology decisions. It aggregates data from GitHub, Reddit, Stack
Overflow, YouTube, Hugging Face, NPM, PyPI, and official docs, verifies
community claims against objective evidence, and generates confidence-scored,
citation-backed reports.

**Why this project exists (context for the agent):** this is a portfolio piece
built to demonstrate agentic AI proficiency in interviews. Technical decisions
here are made for BOTH pragmatic and career-positioning reasons — a working
Python AI core is a hard requirement, not a nice-to-have, even where a
Node-only solution would be simpler.

**Owner background:** strong JavaScript/Node/SQL background, limited Python,
new to most of the AI/ML tooling below. Prefer explanations and inline
comments that don't assume deep Python or LangGraph familiarity yet.

---

## Architecture — polyglot split (do not deviate without asking)

| Layer | Stack |
|---|---|
| **AI core (Python)** | FastAPI, LangGraph (orchestration), LangSmith (observability), tenacity (resilience), spaCy / rapidfuzz / VADER (NLP + scoring) |
| **Gateway + infra (Node.js)** | Express (API gateway), Prisma (ORM), BullMQ (job queues), scraping, frontend |

This split is intentional and settled after iteration — do not propose
collapsing it into a single language stack.

## Hard constraints

1. **Never share a Redis queue between BullMQ and Celery.** They use
   incompatible wire formats and are not interoperable without a translation
   layer. Do not implement or suggest this.
2. **Node → Python communication is HTTP only** (fetch/axios on the Node side
   → FastAPI endpoints on the Python side). Celery, if used at all, is
   strictly internal to the Python service for its own job management — never
   a cross-service bridge.
3. **Migration ownership:** Prisma (Node) is the single source of truth for
   migrations on any database table touched by both services. SQLAlchemy on
   the Python side must not run competing/independent migrations against
   shared tables. If a new shared table is introduced, flag it and confirm
   ownership before generating a migration.
4. Do not silently introduce a new service, queue, or database technology
   outside this stack — propose it and wait for confirmation.

## Build sequencing

- Development follows a **12-phase implementation plan**, deliberately
  sequenced to de-risk the hardest/riskiest parts first, with exit criteria
  per phase.
- Work one phase at a time. Do not jump ahead to a later phase or
  restructure the phase order without confirming first.
- **Current phase:** _fill in before starting a session_
- Before starting a new phase, confirm the previous phase's exit criteria
  were actually met.

### Pre-build validation checklist (confirm before major build work)
- [ ] External API feasibility (GitHub, Reddit, Stack Overflow, YouTube,
      Hugging Face, NPM, PyPI, docs) — rate limits, auth, terms of use
- [ ] LLM cost/latency estimates for the verification pipeline
- [ ] Verification/scoring logic sanity-checked on sample data
- [ ] Data schema drafted and reviewed
- [ ] Competitive landscape check
- [ ] Infrastructure smoke tests (Node ↔ Python HTTP bridge, queues, DB)

## Open decisions — ask, don't assume

These are explicitly unresolved. If a task touches either one, stop and ask
rather than picking a default:

- **Multi-model LLM routing strategy** (which model for which task, fallback
  behavior, cost/quality tradeoffs)
- **Report cache TTL**

## Learning constraints (affects how the agent should behave, not just what it builds)

- Owner is doing a **Python learning sprint** in parallel with the build:
  core syntax, async/await, Pydantic, FastAPI basics, and LangGraph as the
  main investment.
- **LangGraph should be learned concretely, against the real graph being
  built in Phase 1+** — not via abstract tutorials. When implementing
  LangGraph pieces, prefer walking through what the code does over just
  generating it silently.
- **spaCy, rapidfuzz, VADER are reference-level only** — don't over-explain
  these or suggest deep study; use them as needed and link/comment briefly.

## Style / conventions

- Python: PEP 8, type hints, docstrings on public functions, Pydantic models
  for request/response schemas.
- Node: match existing repo conventions (fill in specifics — e.g. ESLint
  config, TS strictness, naming).
- Prefer clear, well-commented code over clever code, given the owner's
  Python unfamiliarity.
- When in doubt about a design decision that isn't covered above, ask rather
  than guessing.

## Workflow expectations

- Use Planning Mode (or `/grill-me`) before implementing anything
  non-trivial — surface the plan and any assumptions before writing code.
- Work incrementally within a phase; don't attempt an entire phase in one
  shot.
- Commit logically-scoped changes so they're easy to review against the
  phase's exit criteria.
  