# Plan: Validation Outbox Retry Recovery

- status: draft
- generated: 2026-07-11
- last_updated: 2026-07-11
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
- depends_on: [Task_2]
- description: Keep transient enqueue failures eligible, apply atomic claim/backoff semantics, and preserve stable job IDs.
- acceptance:
  - A single `queue.add` failure remains retriable.
  - Redis recovery causes the same row to enqueue automatically.
  - Concurrent sweepers cannot create duplicate effective jobs.
  - Exhaustion, if configured, produces a stable terminal error code.
  - Claims use compare-and-set ownership for queue acknowledgement and release.
  - Backoff is bounded exponential with jitter; transient enqueue/ack uncertainty remains recoverable.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run validation-outbox-sweeper focused tests."

### Task_4: Align the initial submission enqueue path
- type: impl
- owns:
  - apps/api/src/routes/forms-public.ts
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

### Task_7: Final validation and review
- type: review
- owns: []
- depends_on: [Task_5, Task_6]
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

## Task Waves
- Wave 1: [Task_1]
- Wave 2: [Task_2]
- Wave 3: [Task_3]
- Wave 4: [Task_4]
- Wave 5 (parallel): [Task_5, Task_6]
- Wave 6: [Task_7]

## Rollback / Safety
- Use expand-contract migration ordering; deploy readers/writers compatibly before removing old fields or semantics.

## Progress Log
- 2026-07-11: Draft created.
- 2026-07-11: Task_1 design approved. Existing timestamps cannot safely represent producer retry eligibility and leases; an additive expand-contract migration is required before producer/sweeper changes.

## Decision Log
- 2026-07-11: Isolated as a state-machine plan because schema, concurrency, and failure-injection evidence must be reviewed together.
- 2026-07-11: Use stable per-row BullMQ IDs for the new durable mode, atomic claims with expiring leases, CAS acknowledgement, at most eight enqueue attempts, and bounded exponential backoff (30 seconds base, 15 minutes cap, jitter). Persist a row-level legacy/stable marker so rolling deployments never reinterpret legacy random-ID rows.
- 2026-07-11: Redis/network/timeouts and queue-success/DB-ack uncertainty are transient; missing providers/rules and deterministic payload/schema failures are terminal. Stale `PROCESSING` reconciliation remains a separate Worker-owned follow-up.
