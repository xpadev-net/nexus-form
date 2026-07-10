# Plan: Realtime E2E Authentication Fixture

- status: draft
- generated: 2026-07-11
- last_updated: 2026-07-11
- work_type: code

## Goal
- Replace obsolete email/password E2E login with a deterministic, production-safe authentication fixture and run realtime collaboration coverage in CI.

## Definition of Done
- Realtime tests no longer navigate to `/auth/signin` or search for removed credentials fields.
- Two distinct authenticated principals can exercise collaboration and permission boundaries.
- CI executes a bounded realtime subset, not merely test discovery.

## Scope / Non-goals
- Scope: E2E auth fixture/helpers, realtime spec, CI selector/harness, narrowly required API/test setup.
- Non-goals: adding production email/password login, live Discord dependency, running every realtime scenario on every PR.

## Tasks

### Task_1: Select a production-safe deterministic auth fixture
- type: research
- owns: []
- depends_on: []
- description: Evaluate Better Auth session seeding, existing invitation admission, and test-only setup boundaries; reject any production-reachable bypass.
- acceptance:
  - Selected method creates two stable users and sessions without live Discord.
  - Any test-only switch is impossible under `NODE_ENV=production` and independently guarded.
  - Cookie/session creation uses the real auth contract rather than fabricated UI state.
  - If production source edits are required, this plan is revised with a separate narrowly owned security Task before dispatch.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Security review of the proposed E2E authentication seam before implementation."

### Task_2: Implement deterministic session fixture data
- type: impl
- owns:
  - e2e/fixtures/auth-session.ts
  - e2e/fixtures/auth-session.test.ts
  - scripts/e2e-auth-session.mjs
- depends_on: [Task_1]
- description: Seed or obtain real Better Auth users/sessions for two principals without adding a production authentication bypass.
- acceptance:
  - User A and B have distinct identities and no cross-context cookie leakage.
  - Fixture setup and teardown are deterministic and idempotent.
  - Generated cookies/sessions use the real signing and persistence contract.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run focused auth-session fixture tests."

### Task_3: Build reusable authenticated browser contexts
- type: test
- owns:
  - e2e/helpers/auth.ts
  - e2e/helpers/auth.test.ts
- depends_on: [Task_2]
- description: Convert the seeded sessions into isolated Playwright contexts and verify them through the actual session endpoint.
- acceptance:
  - Helper creates isolated authenticated contexts for user A and user B.
  - Each context verifies its expected user through the API before a scenario starts.
  - Context cleanup runs safely after partial setup failure.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run the auth helper unit test and a two-context Playwright smoke check."

### Task_4: Modernize realtime collaboration scenarios
- type: test
- owns:
  - e2e/realtime-collaboration.spec.ts
  - e2e/helpers/form.ts
- depends_on: [Task_3]
- description: Replace repeated obsolete login steps, remove fixed sleeps where observable readiness exists, and retain conflict/merge/offline assertions.
- acceptance:
  - All seven scenarios use the shared auth fixture.
  - At least one scenario proves updates cross two authenticated contexts.
  - Cleanup runs even after assertion failure.
- validation:
  - kind: e2e
    required: true
    owner: worker
    detail: "pnpm exec playwright test e2e/realtime-collaboration.spec.ts --project=chromium"

### Task_5: Add a bounded realtime CI slice
- type: chore
- owns:
  - scripts/run-playwright.mjs
  - .github/workflows/ci.yml
  - e2e/realtime-collaboration.spec.ts
- depends_on: [Task_4]
- description: Tag and select representative auto-merge, conflict, and reconnect scenarios while keeping full-suite coverage locally callable.
- acceptance:
  - CI inventory asserts exact realtime test identities/counts.
  - Selected tests execute and skipped/flaky outcomes fail validation.
  - Full realtime spec remains runnable through the standard E2E command.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm test:e2e:ci -- --list, followed by the CI E2E run in the service harness."

### Task_6: Independent browser review and repository validation
- type: review
- owns: []
- depends_on: [Task_5]
- acceptance:
  - Reviewer status is `APPROVED`.
  - Browser evidence covers two principals and realtime transport.
  - Repository checks pass.
- validation:
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Re-run the bounded CI realtime slice and inspect trace/network evidence."
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm lint:fix && pnpm type-check && pnpm test --silent"

## Task Waves
- Wave 1: [Task_1]
- Wave 2: [Task_2]
- Wave 3: [Task_3]
- Wave 4: [Task_4]
- Wave 5: [Task_5]
- Wave 6: [Task_6]

## E2E / Visual Validation Spec
- provider: playwright-cli
- artifact_root: `.playwright-cli/realtime-e2e-auth/`
- base_url: `http://localhost:3000`
- app_start_command: use the existing CI API/Web/Worker service harness.
- readiness_check: API health, Web root, Worker readiness, and two session checks pass.
- flows: two-user auto-merge; same-field conflict resolution; offline/reconnect synchronization.
- viewports: desktop 1440x900.
- evidence_requirements: traces for both contexts, SSE network evidence, final converged form state, console summary.
- known_flakiness: no live OAuth; replace arbitrary sleeps with state/event waits.

## Rollback / Safety
- Test authentication must remain unreachable in production; rollback CI selection independently if environmental flakiness appears.

## Progress Log
- 2026-07-11: Draft created.

## Decision Log
- 2026-07-11: Kept this separate from login UX because deterministic multi-principal test authentication is a security-sensitive test-infrastructure change.
