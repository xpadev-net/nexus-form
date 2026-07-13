# Plan: Validation Outbox Retry Recovery

- status: in_progress
- generated: 2026-07-11
- last_updated: 2026-07-14
- work_type: code

## Goal
- Preserve automatic external-validation recovery across transient Redis/BullMQ enqueue failures.

## Definition of Done
- Transient enqueue failures remain retryable with bounded backoff.
- Permanent preparation/configuration errors remain terminal and diagnosable.
- Queue-success/DB-ack ambiguity remains idempotent through stable job IDs.

## Scope / Non-goals
- Scope: validation outbox state, sweeper retry selection, schema/migration if needed, failure-injection tests.
- Non-goals: provider execution retries after a job starts, submit-notification outbox redesign.

## Tasks

### Task_1: Define retriable and terminal enqueue states
- type: design
- owns:
  - docs/coding-agent/plans/active/validation-outbox-retry-recovery-plan.md
- depends_on: []
- description: Decide whether existing timestamps can express bounded backoff or additive retry metadata is required.
- acceptance:
  - Redis/network enqueue errors are retriable.
  - Invalid provider/rule/job payload errors are terminal.
  - Retry attempts and next-attempt eligibility are observable and bounded.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Review state machine, migration compatibility, and retry-storm controls."
- status: complete

### Task_2: Add retry metadata and migration
- type: impl
- owns:
  - packages/database/src/schema.ts
  - packages/database/drizzle/*.sql
  - packages/database/drizzle/meta/**
- depends_on: [Task_1]
- description: Add only the retry-attempt/eligibility metadata selected by Task_1 using expand-contract migration ordering.
- acceptance:
  - Existing rows receive safe defaults and remain readable by old code during rollout.
  - Additive fields support a claim token/lease expiry, enqueue attempt count, next-attempt eligibility, and a durable legacy/stable enqueue-mode marker.
  - Existing timestamp, Worker-attempt, and manual-retry meanings remain unchanged.
  - The eligibility/lease index supports bounded concurrent sweeper claims.
  - Migration journal and snapshot metadata remain consistent.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run database migration journal and schema compatibility tests."

### Task_3: Implement sweeper retry and backoff
- type: impl
- owns:
  - apps/api/src/lib/forms/validation-outbox-sweeper.ts
  - apps/api/src/lib/forms/__tests__/validation-outbox-sweeper.test.ts
- depends_on: [Task_2, Task_8]
- description: Keep transient enqueue failures eligible, apply atomic claim/backoff semantics, and preserve stable job IDs.
- acceptance:
  - A single `queue.add` failure remains retriable.
  - Redis recovery causes the same row to enqueue automatically.
  - Concurrent sweepers cannot create duplicate effective jobs.
  - Exhaustion, if configured, produces a stable terminal error code.
  - Claims use compare-and-set ownership for queue acknowledgement and release.
  - Claim expiry, reclaim, and renewal use MySQL server time so API-node clock skew cannot extend or steal ownership.
  - The API producer uses the shared stable outbox job-ID builder consumed by the Worker admission fence.
  - Backoff is bounded exponential with jitter; transient enqueue/ack uncertainty remains recoverable.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run validation-outbox-sweeper focused tests."
- status: complete

### Task_4: Align the initial submission enqueue path
- type: impl
- owns:
  - apps/api/src/routes/forms-public.ts
  - apps/api/src/__tests__/forms-public-validation-outbox.test.ts
- depends_on: [Task_3]
- description: Make the immediate post-submit enqueue attempt use the same retriable/terminal state semantics as the sweeper.
- acceptance:
  - Initial transient enqueue failure leaves the committed outbox row recoverable.
  - Permanent payload/provider preparation errors remain terminal and diagnosable.
  - Queue success followed by DB acknowledgement failure remains recoverable via the stable job ID.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-public-validation-outbox.test.ts"
- status: complete

### Task_5: Add runtime failure-injection tests
- type: test
- owns:
  - apps/api/src/__tests__/forms-public-validation-outbox.test.ts
  - apps/api/src/lib/forms/__tests__/validation-outbox-sweeper.test.ts
- depends_on: [Task_3, Task_4]
- acceptance:
  - Tests cover fail-once/recover, repeated failure/backoff, concurrent sweepers, and queue-success/DB-ack failure.
  - Tests exercise both immediate submission enqueue and periodic sweeper recovery.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-public-validation-outbox.test.ts src/lib/forms/__tests__/validation-outbox-sweeper.test.ts"
- status: complete

### Task_6: Add migration compatibility coverage
- type: test
- owns:
  - apps/api/src/__tests__/database-migration-journal.test.ts
  - apps/api/src/__tests__/database-snapshot-structure-migration.test.ts
- depends_on: [Task_2]
- acceptance:
  - Tests confirm additive rollout and rollback-safe reads for retry metadata.
  - Migration journal, snapshot, and generated ordering remain internally consistent.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/database-migration-journal.test.ts src/__tests__/database-snapshot-structure-migration.test.ts"
- status: complete

### Task_7: Final validation and review
- type: review
- owns: []
- depends_on: [Task_5, Task_6, Task_8]
- acceptance:
  - Reviewer status is `APPROVED`.
  - Repository checks pass.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm lint:fix && pnpm type-check && pnpm test --silent"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent concurrency, retry, and rolling-deploy review."

### Task_8: Add persistent Worker admission for stable outbox jobs
- type: impl
- owns:
  - packages/shared/src/worker-jobs.ts
  - packages/shared/src/index.ts
  - packages/shared/src/__tests__/worker-jobs.test.ts
  - apps/worker/src/lib/validation-helpers.ts
  - apps/worker/src/lib/__tests__/validation-helpers.test.ts
- depends_on: [Task_2]
- description: Add a shared stable outbox job-ID contract and make the Worker database transition the durable fence against late or replayed BullMQ delivery.
- acceptance:
  - API and Worker can share one colon-free `validation-outbox` job-ID prefix and builder without activating producer changes in this prerequisite slice.
  - A STABLE outbox row starts only from `PENDING` with `jobId` null or matching, and a BullMQ retry resumes only from `PROCESSING` with the same job ID.
  - `COMPLETED`, `FAILED`, or missing rows, mismatched job IDs, and LEGACY rows fail with `StaleValidationJobError` before provider execution.
  - Existing retry/revalidation/legacy job semantics remain unchanged; the outbox path has a dedicated admission branch rather than broadening generic strict ownership.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run shared worker-job tests, Worker validation-helper tests, and generic-validation stale short-circuit tests."
  - kind: command
    required: true
    owner: worker
    detail: "pnpm lint:fix && pnpm type-check && pnpm test --silent"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independently verify terminal-row replay rejection, retry compatibility, LEGACY exclusion, and producer/consumer job-ID parity."
- status: complete

## Task Waves
- Wave 1: [Task_1]
- Wave 2: [Task_2]
- Wave 3: [Task_8]
- Wave 4: [Task_3]
- Wave 5: [Task_4]
- Wave 6 (parallel): [Task_5, Task_6]
- Wave 7: [Task_7]

## Rollback / Safety
- Use expand-contract migration ordering; deploy readers/writers compatibly before removing old fields or semantics.

## Progress Log
- 2026-07-11: Draft created.
- 2026-07-11: Task_1 design approved. Existing timestamps cannot safely represent producer retry eligibility and leases; an additive expand-contract migration is required before producer/sweeper changes.
- 2026-07-13: Task_3 formal review reproduced a late-delivery replay after lease renewal, reclaim, completion, and finite BullMQ job eviction. Split Task_8 as a prerequisite Worker admission fence; PR #666 remains stopped at exact head `5cdc70ca58131ceb7fa1c432bb86f22aeda3cecf` until Task_8 merges.
- 2026-07-14: Task_8 merged via PR #670 as `bf334a6aec15d2eef633da671bb7eb2641bd744b` after exact-head formal approval and parent merge gates. Task_3 resumes in the existing PR #666 Worker with its original two-file ownership, using the shared builder plus MySQL server-time lease fencing before fresh formal review.
- 2026-07-14: Task_3 merged via PR #666 as `ddceb0e647d88a1b4e5ce6ff43ffa59b6b90ccc5`. Formal review independently verified server-time eligibility/lease SQL, stable job-ID parity, CAS and counter semantics, bounded jitter, acknowledgement uncertainty, LEGACY exclusion, and Worker late-delivery fencing; parent deep-review, hook, lint, type-check, full tests, focused sweeper/shared/Worker suites, CI, and AI review gates passed.
- 2026-07-14: Started Task_4 Worker `019f5d31-c28a-7ac1-ba52-9f4d5bfd53bb` on `codex/outbox-4-submission-enqueue-retry` from current origin/master. Startup stability passed and the Worker proceeded into baseline investigation. It owns only `apps/api/src/routes/forms-public.ts`; Task_5 retains failure-injection test ownership, and the Worker must stop at REVIEW_READY for parent formal review.
- 2026-07-14: Expanded Task_4 ownership by `apps/api/src/__tests__/forms-public-validation-outbox.test.ts` because five existing assertions encoded the old random-ID and terminal transient-enqueue contract, causing the focused/full/pre-push gates to fail after the correct route change. Task_4 may update those assertions and add direct producer/ack regressions only; Task_5 retains broader failure-injection and sweeper-recovery coverage.
- 2026-07-14: Task_4 merged via PR #674 as `14455b34c70c5186c04fd4d73cba61cde90bc613`. The direct producer now reserves the first shared enqueue attempt with a full STABLE/PENDING ownership CAS, uses the shared deterministic job ID, leaves transient queue and acknowledgement uncertainty recoverable, and keeps deterministic preparation failures terminal before attempt consumption. Formal Reviewer and parent gates passed, including producer 41, PWR/auth/JWT 63, sweeper 24, full repository validation, hook exit 0, CI, and AI review. Task_5 and Task_6 are dependency-ready.
- 2026-07-14: Started Task_5 Worker `019f5d77-371a-72e3-8f3c-3e6e2d52ea76` for the two runtime failure-injection test files and Task_6 Worker `019f5d77-6c9a-7e43-8501-6274e71bebbe` for the two migration compatibility test files. Ownership is disjoint, both start from current origin/master, and each stops at REVIEW_READY before parent formal review.
- 2026-07-14: Task_5 merged via PR #675 as `df99507d3619ac8ea415c8ed99115b39ee66787b`. The behavioral harness now applies production-generated predicates to persistent row state across direct enqueue, periodic sweeps, shared maximum-eight attempts, concurrent claims, bounded backoff, and acknowledgement uncertainty. Formal Reviewer and parent merge gates passed; live MySQL/Redis/BullMQ/provider integration remains the explicit non-blocking residual for final Task_7 review.
- 2026-07-14: Task_6 merged via PR #676 as `017cf33ff7017ad258fa63f5245f4e1186a4b8de`. The compatibility tests now pin exact retry-metadata column/index shape, journal and snapshot ordering, rollback-reader compatibility, and the ordered six-operation `INFORMATION_SCHEMA` guard through `DEALLOCATE` wiring with unsafe mutation counterexamples. Formal Reviewer and parent merge gates passed; live MySQL execution remains a non-blocking residual for final Task_7 review.

## Decision Log
- 2026-07-11: Isolated as a state-machine plan because schema, concurrency, and failure-injection evidence must be reviewed together.
- 2026-07-11: Use stable per-row BullMQ IDs for the new durable mode, atomic claims with expiring leases, CAS acknowledgement, at most eight enqueue attempts, and bounded exponential backoff (30 seconds base, 15 minutes cap, jitter). Persist a row-level legacy/stable marker so rolling deployments never reinterpret legacy random-ID rows.
- 2026-07-11: Redis/network/timeouts and queue-success/DB-ack uncertainty are transient; missing providers/rules and deterministic payload/schema failures are terminal. Stale `PROCESSING` reconciliation remains a separate Worker-owned follow-up.
- 2026-07-13: A producer-side renewal CAS and finite BullMQ retention do not fence a `queue.add` command that executes after a second claimant has completed and its job record was evicted. Add Task_8 first so the Worker's durable row transition rejects terminal, missing, mismatched, and LEGACY replays before provider execution. Keep Task_3's API diff narrow: use the shared builder and MySQL `CURRENT_TIMESTAMP`/`TIMESTAMPADD` lease comparisons; no schema migration or Redis command-timeout change is required because client timeouts cannot cancel late server execution.
- 2026-07-14: A production contract change and its existing direct contract test are one reviewable Task when old assertions otherwise make the repository and pre-push gates impossible to satisfy. Task_4 therefore owns the narrow producer test update, while Task_5 remains responsible for broader cross-component failure injection after Task_4 merges.
