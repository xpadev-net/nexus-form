# Plan: R14-M3 Validation Cancel Error

- status: completed
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal
- Cancel validation failures surface user-visible error feedback instead of appearing unresponsive.

## Definition of Done
- `cancel` mutation in `apps/web/src/components/forms/validation-result-list.tsx` has an `onError` path matching retry-style API error toast behavior.
- Relevant validation result state is reconciled after cancel failure when needed.
- Component/unit coverage proves 409/403/network-style cancel failures are shown to users.
- Required repository validation passes or failures are recorded with evidence.
- Independent Reviewer approves the final diff.

## Scope / Non-goals
- Scope:
  - `apps/web/src/components/forms/validation-result-list.tsx`
  - Focused component/unit tests for validation cancel error handling
- Non-goals:
  - API contract changes
  - Validation worker behavior changes
  - Broad UI redesign

## Context (workspace)
- Related files/areas:
  - `apps/web/src/components/forms/validation-result-list.tsx`
  - Existing web tests discovered during Task_1
- Existing patterns or references:
  - Retry mutation error handling in the same component
  - Existing toast/test helpers discovered during Task_1
- Repo reference docs consulted:
  - `AGENTS.md` task instructions provided by delegation
  - `/Users/xpadev/.codex/RTK.md`
  - Harness skills: `orchestration-harness`, `plan-format`, `subagent-strategy`, `subagent-report-contract`, `git-workflow`, `engineering-quality-baselines`

## Open Questions (max 3)
- None.

## Assumptions
- User delegation authorizes implementation without waiting for separate plan approval.
- Repository rule suite is absent in this worktree; use AGENTS/CLAUDE instructions and harness defaults.
- Network error can be represented in component tests by a rejected cancel mutation.

## Tasks

### Task_1: Research current cancel/retry and tests
- type: research
- owns: []
- depends_on: []
- description: |
  Read existing component and test patterns to choose the minimal implementation and test files.
- acceptance:
  - Current cancel and retry mutation behavior is summarized with file references.
  - Test location and mocking strategy are identified.
  - Minimal edit scope is confirmed.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "Researcher or Orchestrator evidence identifies implementation and test targets"

### Task_2: Implement cancel error feedback and tests
- type: impl
- owns:
  - apps/web/src/components/forms/validation-result-list.tsx
  - apps/web/src/**/*.test.ts
  - apps/web/src/**/*.test.tsx
  - apps/api/vitest.config.ts
  - apps/api/src/__tests__/routes.test.ts
  - apps/api/src/__tests__/s3-ownership.test.ts
- depends_on: [Task_1]
- description: |
  Add cancel mutation `onError` feedback using the API error message toast pattern and update focused tests.
- acceptance:
  - Cancel API errors produce a user-visible failure toast/message.
  - 409/403/network-style rejected cancel calls are covered by focused tests or equivalent component coverage.
  - Existing retry success/error behavior remains unchanged.
  - TypeScript avoids `any` and unnecessary type assertions.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "Focused web test covering validation cancel error handling"
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
    detail: "pnpm test --silent or documented fallback"

### Task_3: Independent review
- type: review
- owns: []
- depends_on: [Task_2]
- description: |
  Reviewer independently checks the diff, tests, and acceptance criteria.
- acceptance:
  - Reviewer status is APPROVED.
  - Any reviewer findings are fixed or explicitly waived with rationale.
  - Review includes validation evidence review.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent review vs R14-M3 acceptance criteria"

### Task_4: PR, review hook, and merge
- type: chore
- owns: []
- depends_on: [Task_3]
- description: |
  Commit, push, open PR, run `gh-review-hook` until exit 0, then merge.
- acceptance:
  - Branch contains one coherent commit for this change.
  - PR URL is recorded.
  - `gh-review-hook <PR番号>` exits 0.
  - PR is merged and merge commit is recorded.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "git status/branch gate before commit"
  - kind: command
    required: true
    owner: orchestrator
    detail: "gh-review-hook <PR番号> exit 0"
  - kind: command
    required: true
    owner: orchestrator
    detail: "gh pr merge succeeds and merge commit is recorded"

## Task Waves (explicit parallel dispatch sets)

- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]
- Wave 4 (parallel): [Task_4]

## E2E / Visual Validation Spec

- provider: not required
- artifact_root: n/a
- base_url: n/a
- app_start_command: n/a
- readiness_check: n/a
- flows: Component/unit tests cover user-visible toast behavior for cancel failure.
- viewports: n/a
- evidence_requirements: Test assertions for displayed failure reason.
- known_flakiness: none known

## Rollback / Safety
- Revert the single change commit if cancel error feedback or tests regress behavior.

## Progress Log (append-only)

- 2026-06-01 00:00 Wave 1 started: [Task_1]
  - Summary: Researcher dispatched for read-only context; plan created from task instructions.
  - Validation evidence: pending Researcher report.
  - Notes: Repo rules absent; user delegation authorizes implementation.
- 2026-06-01 16:18 Wave 1 completed: [Task_1]
  - Summary: Researcher found cancel `onError` already present; missing pieces were error-time refetch and regression tests.
  - Validation evidence: Researcher report identified target component, hook, API error message path, and test patterns.
  - Notes: Implementation scope narrowed to refetch plus component coverage.
- 2026-06-01 16:34 Wave 2 completed: [Task_2]
  - Summary: Cancel error callback now shows the existing error toast and refetches validation results; added component tests for 409, 403, network, and non-Error fallback failures.
  - Validation evidence: `pnpm --filter @nexus-form/web exec vitest run src/components/forms/validation-result-list.test.tsx` passed; `pnpm lint:fix` passed; `pnpm type-check` passed; `pnpm test --silent` failed because Turbo rejects direct `--silent`; fallback `pnpm test -- --silent` passed.
  - Notes: Biome formatted the new test file.
- 2026-06-01 16:35 Wave 3 completed: [Task_3]
  - Summary: Independent Reviewer approved the diff with no findings.
  - Validation evidence: Reviewer inspected `validation-result-list.tsx`, `validation-result-list.test.tsx`, and `use-validation-results.ts`; reviewer reran the focused test successfully.
  - Notes: Residual risk is limited to refetch failure visibility, accepted as outside the cancel API failure notification requirement.
- 2026-06-01 17:15 Wave 4 in progress: [Task_4]
  - Summary: PR #436 was created; first `gh-review-hook 436` had all checks green but failed because the branch was 7 commits behind `master`. Merged `origin/master` into the branch and found local API tests exceeding 30s timeouts after the base update.
  - Validation evidence: `unbounded-query-pagination.test.ts` passed standalone; `forms-public-validation-outbox.test.ts` passed after increasing API Vitest timeout; `routes.test.ts` and `s3-ownership.test.ts` passed after aligning explicit `beforeAll` timeouts.
  - Notes: Timeout changes are validation-stability fixes needed after base merge, not product behavior changes.

## Decision Log (append-only; re-plans and major discoveries)

- 2026-06-01 00:00 Decision: proceed without separate plan approval.
  - Trigger / new insight: Delegation explicitly assigns implementation, validation, PR, review-hook, and merge to this thread.
  - Plan delta (what changed): Plan status set to in_progress.
  - Tradeoffs considered: Waiting for approval would block delegated execution despite explicit task ownership.
  - User approval: yes, via delegation prompt.
- 2026-06-01 16:18 Decision: implement Task_2 directly in the Orchestrator thread.
  - Trigger / new insight: Read-only research showed `onError` already existed, leaving only a tightly scoped refetch addition and component regression test.
  - Plan delta (what changed): Task_2 focused test validation owner changed from worker to orchestrator.
  - Tradeoffs considered: A Worker handoff would add merge overhead without improving coverage for the narrowed change; independent Reviewer remains required.
  - User approval: yes, via delegated implementation ownership.
- 2026-06-01 17:15 Decision: include API test timeout stability edits after merging `origin/master`.
  - Trigger / new insight: Required `pnpm test -- --silent` failed in API tests because several existing tests exceeded hard-coded 30s limits locally after the base update; standalone reruns showed slow tests pass when given enough time.
  - Plan delta (what changed): Task_2 owns expanded to include API Vitest timeout config and two explicit beforeAll timeouts.
  - Tradeoffs considered: Leaving validation failed would block completion; increasing timeout avoids changing production code or weakening assertions.
  - User approval: yes, via instruction to resolve validation failures even outside the immediate PR scope.

## Notes
- Risks:
  - Toast mock/test setup may need alignment with existing app test utilities.
  - Full repo validation may surface unrelated failures; record and triage if encountered.
- Edge cases:
  - Authorization failure, conflict/completed state, and network rejection should all show a failure reason.
