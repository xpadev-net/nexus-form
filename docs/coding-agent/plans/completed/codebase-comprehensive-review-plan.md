# Plan: Codebase Comprehensive Review

- status: done
- generated: 2026-07-11
- last_updated: 2026-07-11
- work_type: research

## Goal
- Review the entire monorepo from architecture, security, contract, lifecycle, UI, data, integration, and test perspectives and report verified actionable findings in Japanese.

## Definition of Done
- Major runtime surfaces and repository configuration are inventoried.
- Candidate findings are checked against callers, guards, schemas, and tests for counter-evidence.
- Findings are severity-ordered with exact file/line evidence and realistic failure paths.
- Required repository validation commands are run and their results are reported.

## Scope / Non-goals
- Scope: Hand-written source, configuration, schemas/migrations, and tests under the repository.
- Non-goals: Editing implementation code, publishing GitHub comments/issues, and exhaustive review of generated artifacts or lockfile contents.

## Context (workspace)
- Related files/areas: `apps/**`, `packages/**`, root configuration, `docs/**` where it defines contracts.
- Existing patterns or references: Hono RPC, dual auth, Redis/SSE, BullMQ, Drizzle, React/TanStack Query.
- Repo reference docs consulted: user-provided repository instructions; harness rule suite is absent.

## Open Questions (max 3)
- None; the request explicitly authorizes a repository-wide read-only review.

## Assumptions
- Current working tree, including user changes, is the review target.
- Generated outputs, vendored files, and lockfile internals are deprioritized unless they expose a concrete risk.

## Tasks

### Task_1: Repository inventory and risk map
- type: research
- owns: []
- depends_on: []
- description: |
  Map architecture, entrypoints, trust boundaries, validation commands, and high-risk execution paths without editing files.
- acceptance:
  - Major packages, entrypoints, and cross-package contracts are identified.
  - High-risk review targets are ranked with file evidence.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "Research report is reconciled against the repository tree and manifests."

### Task_2: Backend, auth, and contract review
- type: review
- owns: []
- depends_on: [Task_1]
- description: |
  Review API routes, authentication/authorization, runtime validation, database access, and external-input sinks.
- acceptance:
  - Every reported issue identifies a broken contract and realistic failure path.
  - Auth and boundary findings are checked for upstream guards and covering tests.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent perspective review with exact file/line evidence and refutation checks."

### Task_3: Jobs, integrations, realtime, and data review
- type: review
- owns: []
- depends_on: [Task_1]
- description: |
  Review BullMQ state transitions, external integrations, Redis/SSE lifecycle, retries, cleanup, idempotency, schemas, and migrations.
- acceptance:
  - Producer/consumer and reader/writer contracts are traced end to end.
  - Reported issues include concurrency, retry, cleanup, or rollout evidence where applicable.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent perspective review with exact file/line evidence and refutation checks."

### Task_4: Frontend, UX, and test-quality review
- type: review
- owns: []
- depends_on: [Task_1]
- description: |
  Review React/TanStack Query lifecycle, request/error behavior, accessibility, state consistency, and regression coverage.
- acceptance:
  - UI findings identify user-visible failure modes and relevant lifecycle or accessibility contracts.
  - Test gaps are reported only for concrete risks.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent perspective review with exact file/line evidence and refutation checks."

### Task_5: Integration, verification, and final report
- type: review
- owns:
  - docs/coding-agent/plans/active/codebase-comprehensive-review-plan.md
  - docs/coding-agent/plans/completed/codebase-comprehensive-review-plan.md
- depends_on: [Task_2, Task_3, Task_4]
- description: |
  De-duplicate and independently verify candidate findings, run required checks, and produce the Japanese review report.
- acceptance:
  - Findings are ordered by severity and include current line references.
  - Counter-evidence is checked for every published finding.
  - Validation status and residual review limitations are explicit.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm lint:fix"
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm type-check"
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm test --silent"
  - kind: review
    required: true
    owner: orchestrator
    detail: "Final verification filter applied to all candidate findings."

## Task Waves (explicit parallel dispatch sets)

- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2, Task_3, Task_4]
- Wave 3 (parallel): [Task_5]

## Rollback / Safety
- No implementation files will be edited. The review plan is the only planned artifact and can be removed without runtime impact.

## Progress Log (append-only)

- 2026-07-11 Wave 1 started: [Task_1]
  - Summary: Repository inventory delegated before source exploration per harness research gate.
  - Validation evidence: pending.
  - Notes: `docs/coding-agent/rules/` is absent; user-provided repository instructions are used instead.
- 2026-07-11 Wave 1 completed: [Task_1]
  - Summary: Orchestrator completed the repository inventory after two Researcher dispatches failed to return.
  - Validation evidence: package tree, manifests, entrypoints, trust boundaries, and required commands were inspected.
  - Notes: Researcher requirement waived due repeated runtime non-response; source exploration remained read-only.
- 2026-07-11 Wave 2 completed: [Task_2, Task_3, Task_4]
  - Summary: Independent backend/security, jobs/realtime/data, and frontend/tests reviews returned and were integrated.
  - Validation evidence: candidate findings include exact paths/lines, realistic failure paths, and counter-evidence checks; Orchestrator re-read the highest-risk paths.
  - Notes: No implementation files were edited.
- 2026-07-11 Wave 3 started: [Task_5]
  - Summary: Required lint, type-check, and test commands passed; final candidate packet is being independently reviewed.
  - Validation evidence: `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent` all exited 0.
  - Notes: Full browser E2E was not required by repository closeout commands and was not run; static review found stale full-suite auth helpers.
- 2026-07-11 Wave 3 completed: [Task_5]
  - Summary: Candidate findings were de-duplicated, re-verified, severity-calibrated, and approved as an accurate review artifact by the final Reviewer.
  - Validation evidence: Reviewer status `APPROVED`; `pnpm test:e2e:ci -- --list` also exited 0 and confirmed the 14-test fixed CI selector excludes the stale realtime collaboration spec.
  - Notes: Google timeout candidate was dropped for insufficient end-to-end verification; telemetry-token atomicity was omitted because clients can acquire replacement tokens and the intended one-attempt semantics were not established.

## Decision Log (append-only; re-plans and major discoveries)

- 2026-07-11 Decision: Treat the explicit repository-wide review request as plan approval.
  - Trigger / new insight: The task is read-only but non-trivial and spans all runtime boundaries.
  - Plan delta (what changed): Use one research wave followed by three independent perspective reviews.
  - Tradeoffs considered: Broad coverage with risk-based prioritization; generated artifacts are deprioritized.
  - User approval: yes (explicit request).

## Notes
- Risks: Repository size may leave low-risk files sampled rather than exhaustively reasoned line by line.
- Edge cases: Existing uncommitted changes remain in scope and will not be overwritten.
