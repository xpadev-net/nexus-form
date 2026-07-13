# Plan: Migration Connection Readiness

- status: in_progress
- generated: 2026-07-14
- last_updated: 2026-07-14
- work_type: code

## Goal
- Make the standalone migration Job tolerate bounded transient MySQL disconnects before any DDL starts, while preserving fail-closed behavior and preventing unsafe whole-migration retries.

## Definition of Done
- The migration runner imports the dedicated `@nexus-form/database/migrate` entrypoint without initializing the API database pool.
- Transient connection failures during the pre-DDL compatibility read use a fresh client and bounded retry; non-transient failures and all failures after migrator entry are never retried.
- Focused lifecycle tests, repository-required checks, independent subagent review, PR review hook, GitHub review decision, and merge gates pass.
- The PR is merged only after `gh-review-hook` exits 0 on the current remote head.

## Scope / Non-goals
- Scope: migration connection lifecycle, pre-DDL transient retry classification, standalone runner import, deterministic regression coverage, validation, review, PR, and merge.
- Non-goals: retrying DDL, changing schema contents, hiding authentication/permission/SQL failures, or asserting an unproven external MySQL/proxy root cause.

## Context (workspace)
- Related files/areas: `packages/database/src/migrate.ts`, API migration tests, `scripts/run-migrations.mjs`, container runtime wiring checks.
- Existing pattern: MySQL migrations are owned by a dedicated Job; MySQL DDL may commit implicitly and therefore cannot be retried as one opaque operation.
- Research evidence: the reported stack fails in the first `INFORMATION_SCHEMA` query before Drizzle migrator entry; the only explicit pool `end()` is in `finally`.
- Repo rule suite: absent (`docs/coding-agent/rules/` does not exist).

## Open Questions (max 3)
- None. External DB/proxy logs remain operational evidence, not a blocker to the bounded pre-DDL resilience fix.

## Assumptions
- `PROTOCOL_CONNECTION_LOST`, `ECONNRESET`, and connection timeout errors before migrator entry are transient candidates; authentication, permission, and SQL-shape errors must fail immediately.
- The previous user-approved branch/review/PR/hook/merge workflow applies to this continuation of the migration incident.

## Tasks

### Task_1: Add safe pre-DDL connection readiness handling
- type: impl
- owns:
  - packages/database/src/migrate.ts
  - apps/api/src/__tests__/database-migration-journal.test.ts
  - apps/api/src/__tests__/database-migration-connection-readiness.test.ts
  - scripts/run-migrations.mjs
  - scripts/check-container-runtime-wiring.mjs
  - scripts/check-container-runtime-wiring.test.mjs
- depends_on: []
- description: |
  Use the migration-only package entrypoint and add a bounded fresh-client retry boundary around compatibility preflight only. Add regression tests for transient recovery, cleanup, exhaustion, non-transient fail-fast behavior, and no retry after migrator entry.
- acceptance:
  - Each failed preflight attempt closes its client exactly once and a successful fresh client continues through migration and final security verification.
  - Only explicitly classified transient transport failures retry, with a finite attempt count and bounded delay.
  - The migrator and post-migration verification are outside the retry loop; a failure after migrator entry invokes the migrator once.
  - The standalone runner imports `@nexus-form/database/migrate`, and the wiring check rejects the package-root import.
  - Existing migration journal and container wiring behavior remains green.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "rtk pnpm --filter @nexus-form/api exec vitest run src/__tests__/database-migration-connection-readiness.test.ts src/__tests__/database-migration-journal.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "rtk pnpm test:container-runtime-wiring"
  - kind: command
    required: true
    owner: worker
    detail: "rtk pnpm --filter @nexus-form/database type-check && rtk pnpm --filter @nexus-form/api type-check"

### Task_2: Integrate, validate, and independently review
- type: review
- owns: []
- depends_on: [Task_1]
- description: |
  Integrate the Worker report, inspect the retry boundary and failure semantics, run all repository-required validation, and repeat independent subagent review until no actionable findings remain.
- acceptance:
  - Worker changes stay within declared ownership and all required focused evidence passes.
  - Repository lint, type-check, tests, container wiring, and production build checks pass.
  - Independent Reviewer status is `APPROVED` with no actionable findings.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "rtk pnpm lint:fix"
  - kind: command
    required: true
    owner: orchestrator
    detail: "rtk pnpm type-check"
  - kind: command
    required: true
    owner: orchestrator
    detail: "rtk pnpm test --silent"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review retry classification, fresh-client cleanup, DDL retry exclusion, import side effects, and regression evidence"

### Task_3: Publish, review-hook, and merge
- type: chore
- owns: []
- depends_on: [Task_2]
- description: |
  Commit and push the coherent fix, open a PR with `gh`, run `gh-review-hook`, address every actionable finding with validated commits, and merge only after all gates pass.
- acceptance:
  - The branch is pushed and the PR documents the proven failure point, bounded retry boundary, and external root-cause limitation.
  - `gh-review-hook` exits 0 on the current remote head.
  - GitHub reports no `CHANGES_REQUESTED`, all checks pass, the PR is mergeable, and local/remote heads match.
  - The PR is merged.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "Run gh-review-hook to exit 0 after every review-fix push"
  - kind: review
    required: true
    owner: orchestrator
    detail: "Verify gh pr metadata: reviewDecision, mergeStateStatus, statusCheckRollup, and headRefOid"

## Task Waves (explicit parallel dispatch sets)
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]

## Rollback / Safety
- Revert the retry boundary and dedicated import together if production validation fails. Never broaden the retry loop across Drizzle migrator entry or post-DDL verification.
- Do not rewrite history or force-push once the PR is open.

## Progress Log (append-only)
- 2026-07-14: Research completed. The disconnect occurs during the first read-only compatibility query, before Drizzle migrator entry; no code-owned early close was found.
- 2026-07-14: Wave 1 / Task_1 completed and integrated. Worker changed only declared `owns`; focused migration tests passed 20/20, container wiring passed 10/10, database/API type checks passed, and diff/format checks passed. Orchestrator reran the exact pnpm commands with package-manager management disabled and confirmed all required Worker checks pass.
- 2026-07-14: First independent review requested changes: the timestamp `UPDATE` was inside the retry boundary, and failed-client cleanup could mask the triggering connection error. The review findings were accepted and the implementation returned to Task_1.
- 2026-07-14: Review fixes completed. Only compatibility-state reads retry; the timestamp mutation runs at most once outside the loop. Query-plus-cleanup failures retain both errors in an `AggregateError` and fail closed without retry. Focused migration tests passed 22/22.
- 2026-07-14: Wave 2 / Task_2 completed. Independent Reviewer returned `APPROVED` with no actionable findings. Repository lint, type-check, production build, full tests (15/15 Turbo tasks), container wiring (10/10), and `git diff --check` all passed after the review fixes.

## Decision Log (append-only; re-plans and major discoveries)
- 2026-07-14: Treat this as a continuation of the user-approved migration delivery workflow and proceed without another approval pause. Limit resilience to pre-DDL transient transport failures because whole-migration retry is unsafe under MySQL implicit DDL commits.
- 2026-07-14: Quality routing L3. In scope: TypeScript/JavaScript async failure handling, MySQL migration data integrity, entrypoint side effects, operational failure containment, and migration-focused tests. Frontend/API contracts/auth are out of scope.
- 2026-07-14: A new Worker thread could not be created because the runtime thread limit was reached. Reused the existing migration implementation Worker for this closely related continuation, retained narrow `owns`, and reserved formal approval for an independent review-only subagent.
- 2026-07-14: The completed Worker could not be restarted for the review fixes because the runtime thread limit rejected the follow-up. The Orchestrator applied only the Reviewer-specified changes inside the existing `owns`, reran all validation, and sent the result back to the same independent Reviewer for approval.

## Notes
- Risks: retry misclassification, leaked pools, duplicate DDL, masking persistent configuration errors.
- Operational follow-up: inspect MySQL/proxy logs and Job attempts to identify the external server-close cause; the code fix does not claim to identify it.
