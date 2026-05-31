# R22-L2 Publish Malformed Snapshot Plan

## Context
- `/:id/publish` must not return 500 when the latest snapshot contains malformed `plateContent` JSON.
- Repository rule suite is absent, so validation follows `CLAUDE.md` plus harness defaults.
- User explicitly requested implementation, route test, full validation, sub-agent review, branch push, PR, review hook, and merge if possible.

## Quality Routing
- Routing level: L1
- In-scope docs: `CLAUDE.md`, `orchestration-harness`, `plan-format`, `engineering-quality-baselines`, `git-workflow`
- Out-of-scope docs: UI/E2E gates; no UI or browser flow changes
- Top risks: API behavior, route error handling, regression coverage
- Risk profile: low; local API route behavior and focused tests only

## Task_1
- type: impl
- owns:
  - `apps/api/src/routes/forms-detail.ts`
- depends_on: []
- acceptance:
  - Publish route catches malformed snapshot JSON and returns a controlled 400 error.
  - Publish route does not update form status when snapshot JSON is malformed.
  - Existing valid publish behavior remains unchanged.
- validation:
  - required: true
    owner: orchestrator
    kind: inspection
    detail: Review the route branch and ensure parse failures short-circuit before DB update.

## Task_2
- type: test
- owns:
  - `apps/api/src/__tests__/**`
- depends_on:
  - Task_1
- acceptance:
  - Adds route-level regression coverage for malformed snapshot JSON.
  - Test asserts non-500 status and expected error payload.
  - Test asserts publish DB update is not issued on malformed JSON.
- validation:
  - required: true
    owner: orchestrator
    kind: test
    detail: Run targeted API vitest for the added route test.

## Task_3
- type: review
- owns:
  - none
- depends_on:
  - Task_1
  - Task_2
- acceptance:
  - Independent sub-agent review reports no blocking findings.
  - Any findings are fixed and re-reviewed until no findings remain or a concrete blocker is recorded.
- validation:
  - required: true
    owner: reviewer
    kind: review
    detail: Harness reviewer checks implementation, test, and validation evidence.

## Task_4
- type: chore
- owns:
  - git branch / PR metadata
- depends_on:
  - Task_1
  - Task_2
  - Task_3
- acceptance:
  - Required repo validations pass: `pnpm lint:fix`, `pnpm type-check`, and `pnpm test -- --silent`.
  - Changes are pushed on a `codex/` branch.
  - Pull request is created and review hook is run to exit 0.
  - Merge is attempted only if repository and branch policy allow it.
- validation:
  - required: true
    owner: orchestrator
    kind: command
    detail: Capture validation command outcomes, push result, PR URL, review hook result, and merge result/blocker.

## Task Waves
- Wave 1: Task_1
- Wave 2: Task_2
- Wave 3: Task_3
- Wave 4: Task_4

## Progress Log
- 2026-05-31: Plan created. Repository rule suite was not present under `docs/coding-agent/rules`.
- 2026-05-31: Implemented `parseSnapshotPlateContent` and route-level regression tests.
- 2026-05-31: Targeted API test passed after building `@nexus-form/database` for workspace package entry resolution.
- 2026-05-31: `pnpm lint:fix`, `pnpm type-check`, and `pnpm test -- --silent` passed. `pnpm test --silent` was rejected by Turbo argument parsing before tests ran.
- 2026-05-31: Reviewer sub-agent approved with no findings.
- 2026-05-31: Pre-push hook repeatedly failed only in `pnpm test` because API `beforeAll` hooks timed out at the default 10 seconds under hook parallel load. Aligned API Vitest `hookTimeout` with existing `testTimeout` at 30 seconds.

## Decision Log
- Research approval is considered included in the user's delegation request for sub-agent review and complete harness flow. Researcher dispatched for focused context while implementation proceeds.
- Used `pnpm test -- --silent` for full validation because Turbo 2 rejected `pnpm test --silent` as an unexpected Turbo argument.
- Increased API `hookTimeout` instead of bypassing hooks because repository policy forbids `--no-verify`, and the failing suites were import-heavy `beforeAll` setup under pre-push parallel load rather than R22-L2 behavior failures.
