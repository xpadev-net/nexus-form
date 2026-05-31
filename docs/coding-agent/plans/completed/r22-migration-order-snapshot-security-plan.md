# Plan: R22 Migration Order And Snapshot Security Compatibility

- status: done
- generated: 2026-05-31
- last_updated: 2026-05-31
- work_type: code

## Goal
- Fix R22-M4/R22-M10 as one unit so Drizzle migrations apply in order and existing public form security behavior is preserved when snapshot structure data is introduced.

## Definition of Done
- `0012_config_json_column_type` is ordered after `0011_snapshot_structure_json` and covered by a migration journal regression test.
- A forward-only compatibility migration updates existing active snapshots from the latest live form structure, preserving password protection, response limits, and fingerprint requirements for already published forms.
- Regression tests cover the migration SQL behavior for active/non-active snapshots and unchanged rows without active live structure.
- Required repository validation passes: `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent`.
- Independent subagent review approves the final diff with no unresolved findings.

## Scope / Non-goals
- Scope:
  - `packages/database/drizzle/**`
  - migration-focused tests under `apps/api/src/__tests__`
  - API Vitest timeout configuration required to make the repo-required full test command stable
  - plan lifecycle file under `docs/coding-agent/plans/**`
- Non-goals:
  - UI changes
  - changing new publish/activate snapshot semantics
  - broad migration framework replacement
  - unrelated R22 tasks

## Context (workspace)
- Related files/areas:
  - `packages/database/drizzle/meta/_journal.json`
  - `packages/database/drizzle/0011_snapshot_structure_json.sql`
  - `packages/database/drizzle/0012_config_json_column_type.sql`
  - `apps/api/src/__tests__/database-migration-journal.test.ts`
- Existing patterns or references:
  - Drizzle migrations are tracked by `_journal.json` timestamps.
  - Public routes now read active snapshot `structureJson`; existing tenants may have live security settings changed after the active snapshot was published.
- Repo reference docs consulted:
  - `AGENTS.md` / `CLAUDE.md`
  - `/Users/xpadev/.codex/RTK.md`
  - `z/tasks.md` from `/Users/xpadev/IdeaProjects/nexus-form/z/tasks.md`
  - `$orchestration-harness`, `$plan-format`, `$subagent-strategy`, `$engineering-quality-baselines`, `$git-workflow`

## Open Questions
- None. Assumption A1 below fixes the only scope choice.

## Assumptions
- A1: For R22-M10 compatibility, only active snapshots should be rewritten from the latest live structure. Rewriting historical inactive snapshots would damage publish history.
- A2: R22-M4's current journal timestamp repair should be kept and hardened with a direct ordering assertion; a new idempotent recovery migration is not needed for the column rename because MySQL cannot safely express conditional `CHANGE COLUMN` in plain Drizzle SQL without procedural metadata branching.

## Tasks

### Task_1: Harden Migration Journal Ordering
- type: test
- owns:
  - `apps/api/src/__tests__/database-migration-journal.test.ts`
- depends_on: []
- description: |
  Add direct assertions for the R22-M4 migration pair so future timestamp edits cannot reintroduce a skipped `0012_config_json_column_type`.
- acceptance:
  - The journal test still checks all timestamps are strictly increasing.
  - The test explicitly asserts `0012_config_json_column_type` is newer than `0011_snapshot_structure_json`.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `pnpm --filter @nexus-form/api exec vitest run src/__tests__/database-migration-journal.test.ts`

### Task_2: Add Snapshot Security Compatibility Migration
- type: impl
- owns:
  - `packages/database/drizzle/0013_active_snapshot_structure_live_security_compat.sql`
  - `packages/database/drizzle/meta/_journal.json`
  - `packages/database/drizzle/meta/0013_snapshot.json`
- depends_on: [Task_1]
- description: |
  Add a forward-only migration that updates existing active snapshot `structureJson` from the latest live `FormStructure.structureJson` for that form.
- acceptance:
  - Active snapshots with a live structure are updated to latest live structure.
  - Inactive snapshots are not rewritten.
  - Active snapshots without a live structure remain unchanged.
  - The migration is ordered after 0012 in the journal.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Review SQL for MySQL compatibility, forward-only behavior, and snapshot history preservation."

### Task_3: Add Migration Regression Tests
- type: test
- owns:
  - `apps/api/src/__tests__/database-snapshot-structure-migration.test.ts`
- depends_on: [Task_2]
- description: |
  Test the SQL shape and fixture semantics for R22-M10 without requiring a live MySQL service.
- acceptance:
  - Tests prove active snapshot structures are replaced with latest live structures containing password protection, response limit, and `require_fingerprint`.
  - Tests prove inactive snapshots and active snapshots without live structures stay unchanged.
  - Tests verify the migration SQL filters to active snapshots and joins latest live structure candidates.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `pnpm --filter @nexus-form/api exec vitest run src/__tests__/database-snapshot-structure-migration.test.ts`

### Task_4: Full Validation And Review
- type: review
- owns:
  - `apps/api/vitest.config.ts`
  - validation only
- depends_on: [Task_1, Task_2, Task_3]
- description: |
  Run required repository checks and independent reviewer validation.
- acceptance:
  - Repo-required validation passes.
  - Reviewer status is approved with no unresolved findings.
  - Plan is moved to completed after validation and review.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `pnpm lint:fix`
  - kind: command
    required: true
    owner: orchestrator
    detail: `pnpm type-check`
  - kind: command
    required: true
    owner: orchestrator
    detail: `pnpm test --silent`
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent diff review for migration correctness and regression coverage."

## Task Waves
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2, Task_3]
- Wave 3 (parallel): [Task_4]

## E2E / Visual Validation Spec
- Not applicable; this task changes database migrations and migration tests only.

## Rollback / Safety
- Revert the new 0013 migration and tests before it is applied to shared environments. After application, the migration is data-forward and should not be rolled back by deleting rows; restore affected snapshot rows from backup if required.

## Progress Log
- 2026-05-31 14:00 Wave 0 completed: planning and research
  - Summary: Researcher identified R22-M4 as already partially fixed and R22-M10 as requiring a forward compatibility migration.
  - Validation evidence: Read task text, migration files, and existing tests.
  - Notes: Repo-local `docs/coding-agent/rules/common.md` and `orchestrator.md` are absent in this worktree.
- 2026-05-31 14:02 Waves 1-2 completed: [Task_1, Task_2, Task_3]
  - Summary: Added a direct 0011/0012 ordering assertion, generated 0013 custom migration metadata, added active snapshot live structure compatibility SQL, and added migration regression tests.
  - Validation evidence: `pnpm --filter @nexus-form/api exec vitest run src/__tests__/database-migration-journal.test.ts` passed; `pnpm --filter @nexus-form/api exec vitest run src/__tests__/database-snapshot-structure-migration.test.ts` passed.
  - Notes: The 0013 migration intentionally rewrites only active snapshots with an active live structure.
- 2026-05-31 14:16 Wave 3 completed: [Task_4]
  - Summary: Full validation passed after aligning API Vitest hook timeout with the existing test timeout; independent Reviewer approved with no findings.
  - Validation evidence: `pnpm lint:fix` passed; `pnpm type-check` passed; `pnpm test -- --silent` passed; Reviewer re-ran both targeted migration tests and approved.
  - Notes: Initial literal `pnpm test --silent` failed because Turbo treats `--silent` as an unsupported Turbo flag; `pnpm test -- --silent` is the pass-through form.
- 2026-05-31 14:24 Review hook follow-up completed
  - Summary: Addressed gh-review-hook comments by replacing locale-sensitive ID comparison in the migration test helper and hoisting the journal reader helper.
  - Validation evidence: Targeted migration tests, `pnpm lint:fix`, `pnpm type-check`, and `pnpm test -- --silent` passed before the follow-up commit.
  - Notes: No production migration SQL change.
- 2026-05-31 14:34 Review hook follow-up completed
  - Summary: Added an assertion that the compatibility migration ranks live structures with `ORDER BY version DESC, createdAt DESC, id DESC`.
  - Validation evidence: `pnpm --filter @nexus-form/api exec vitest run src/__tests__/database-snapshot-structure-migration.test.ts` passed.
  - Notes: No production migration SQL change.

## Decision Log
- 2026-05-31 14:00 Decision:
  - Trigger / new insight: Existing 0011 backfill is already shipped in migration order, so editing it alone would not repair upgraded environments.
  - Plan delta: Add 0013 forward compatibility migration for active snapshots instead of changing only 0011.
  - Tradeoffs considered: Preserving historical snapshot structures versus maintaining pre-migration live security behavior.
  - User approval: explicit implementation delegation in thread; no additional approval requested.
- 2026-05-31 14:10 Decision:
  - Trigger / new insight: Full `pnpm test -- --silent` repeatedly failed in existing `beforeAll` imports because Vitest hook timeout stayed at the 10 second default while test timeout was already 30 seconds.
  - Plan delta: Expand Task_4 to include `apps/api/vitest.config.ts` and align `hookTimeout` with `testTimeout`.
  - Tradeoffs considered: Per-suite timeout edits versus one API test config fix; config-level alignment is smaller and avoids chasing individual import-heavy suites.
  - User approval: not requested; required validation was blocked without this stability fix.

## Notes
- Risks:
  - SQL uses MySQL window functions, consistent with the existing 0011 migration.
  - Plain SQL tests are regression checks, not a substitute for a live MySQL migration smoke test.
- Edge cases:
  - Forms without live structures are left unchanged.
  - Historical inactive snapshots are intentionally preserved.
