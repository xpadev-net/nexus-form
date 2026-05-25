# Snapshot Structure Integration Plan

## Context
- Public forms currently read published `plateContent` from `FormSnapshot` but read settings/password/limits from active `FormStructure`.
- This split allows a form to be published with an active snapshot but no active structure, causing public API 500s.
- User approved a breaking change: no runtime compatibility fallback for snapshots that lack `structureJson`.

## Research Waiver
- Subagent research waived: current tool policy only permits spawning agents when explicitly requested. Main-thread inspection covered database schema, snapshot repository, public routes, snapshot routes, and regression tests.

## Quality Routing
- Routing level: L2
- In-scope risks: migration/schema, data integrity, API contract, backend TypeScript.
- Required repo checks: `pnpm lint:fix`, `pnpm type-check`, `pnpm test --silent`.

## Task Waves
- Wave 1: Task_1
- Wave 2: Task_2
- Wave 3: Task_3

## Task_1
- type: impl
- owns:
  - `packages/database/src/schema.ts`
  - `packages/database/drizzle/**`
  - `apps/api/src/types/domain/form-snapshot.ts`
- depends_on: []
- acceptance:
  - `FormSnapshot` has a required `structureJson` column in schema and migration.
  - Migration backfills existing snapshots from each form's active `FormStructure`.
  - Snapshots without active structure receive the default structure JSON during migration.
  - API snapshot domain type includes `structureJson`.
- validation:
  - required: true
    owner: orchestrator
    kind: typecheck
    detail: `pnpm --filter @nexus-form/database type-check`

## Task_2
- type: impl
- owns:
  - `apps/api/src/lib/forms/snapshot-repository.ts`
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/routes/forms-snapshots.ts`
  - `apps/api/src/routes/forms-detail.ts`
  - `apps/api/src/lib/forms/default-form-structure.ts`
- depends_on:
  - Task_1
- acceptance:
  - `publishSnapshot` stores the currently active `FormStructure.structureJson`.
  - New snapshots store the active structure, or the canonical default structure when no active structure exists.
  - New snapshots cannot be created when the active structure JSON is invalid.
  - Public GET, submit, and password verification read `structureJson` from the active snapshot.
  - Public route no longer queries active `FormStructure`.
  - Snapshot activation/restore restores `FormStructure` from the snapshot.
  - Snapshot diff/unpublished-change logic treats structure changes as publishable changes.
- validation:
  - required: true
    owner: orchestrator
    kind: unit
    detail: targeted API tests for snapshot repository and public form routes.

## Task_3
- type: test
- owns:
  - `apps/api/src/__tests__/**`
  - `apps/api/src/lib/forms/__tests__/**`
- depends_on:
  - Task_2
- acceptance:
  - Regression tests cover public GET using snapshot `structureJson`.
  - Regression tests cover submit/password verification using snapshot `structureJson`.
  - Snapshot repository tests cover publishing with structure JSON and change detection when structure changes.
  - Existing invalid structure tests remain fail-closed.
- validation:
  - required: true
    owner: orchestrator
    kind: repo
    detail: `pnpm lint:fix`, `pnpm type-check`, `pnpm test --silent`

## Progress Log
- Switched from missing-structure fallback plan to breaking snapshot integration after user clarification.
- Implemented `FormSnapshot.structureJson`, migration 0011, public route snapshot reads, snapshot publish/restore/activate structure handling, and updated tests.
- Validation passed: `pnpm lint:fix`, targeted API vitest, `pnpm type-check`, and `pnpm test --silent`.

## Decision Log
- No runtime fallback for old snapshots. The migration adds `structureJson` as required and backfills data once.
- Reviewer subagent waived because the available agent tool policy only permits spawning agents when explicitly requested; main-thread diff review was performed after validation.
