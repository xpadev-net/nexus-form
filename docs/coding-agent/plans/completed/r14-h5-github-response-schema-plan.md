# Plan: R14-H5 GitHub Response Schema

- status: done
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal
- Validate GitHub upstream user responses at the client boundary so malformed Octokit data cannot become a successful validation result.

## Definition of Done
- GitHub API user response shape, including timestamps, is runtime-validated before mapping to `GitHubUserInfo`.
- Malformed upstream responses for missing `login`, invalid `id`, and invalid `created_at` are returned as provider errors, not successful validations.
- Required validation passes: `pnpm lint:fix`, `pnpm type-check`, `pnpm test --silent`.
- Independent Reviewer reports APPROVED.

## Scope / Non-goals
- Scope:
  - `packages/validation-provider-github/src/client.ts`
  - `packages/validation-provider-github/src/plugin.ts`
  - `packages/validation-provider-github/src/__tests__/*`
  - plan lifecycle files under `docs/coding-agent/plans/**`
- Non-goals:
  - Worker retry/status semantics unless client/provider boundary tests expose a gap.
  - API, web UI, database, or external plugin loader changes.

## Context (workspace)
- Related files/areas:
  - GitHub client maps Octokit `users.getByUsername` data to provider metadata.
  - GitHub plugin converts `GitHubProviderError` to failed validation results.
  - Worker validates provider metadata but currently omits invalid metadata rather than converting a successful result into failure.
- Existing patterns or references:
  - zod schemas are already used in provider input/config/metadata validation.
  - `GitHubProviderError` is the provider domain error used by plugin validation.
- Repo reference docs consulted:
  - `AGENTS.md` / `CLAUDE.md`
  - `/Users/xpadev/.codex/RTK.md`
  - `$orchestration-harness`
  - `$plan-format`
  - `$engineering-quality-baselines`
  - `$git-workflow`
- Repo rule suite:
  - `docs/coding-agent/rules/*` is absent in this worktree; repository-local `CLAUDE.md` commands are treated as canonical.

## Open Questions
- None.

## Assumptions
- The parent prompt's R14-H5 task text is authoritative because `z/tasks.md` is intentionally absent from this worktree.
- User approval for the execution plan is waived by the delegated instruction to implement, verify, PR, review, and merge end-to-end.

## Tasks

### Task_1: Inspect GitHub Provider Boundary
- type: research
- owns: []
- depends_on: []
- description: |
  Identify current GitHub response mapping, error handling, and test coverage.
- acceptance:
  - Current client/plugin behavior is understood.
  - Required tests and schema gaps are identified.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "Read target files and reconcile Researcher findings before implementation."

### Task_2: Validate Upstream Response At Client Boundary
- type: impl
- owns:
  - packages/validation-provider-github/src/client.ts
  - packages/validation-provider-github/src/plugin.ts
  - packages/validation-provider-github/src/__tests__/*
- depends_on: [Task_1]
- description: |
  Strengthen the GitHub API response schema and add focused tests proving malformed upstream data is not accepted as success.
- acceptance:
  - Missing `login` throws `GitHubProviderError` with `GITHUB_API_ERROR`.
  - Invalid `id` throws `GitHubProviderError` with `GITHUB_API_ERROR`.
  - Invalid `created_at` throws `GitHubProviderError` with `GITHUB_API_ERROR`.
  - Plugin converts provider schema errors to `isValid: false` with no success metadata.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm --filter @nexus-form/validation-provider-github test -- --runInBand if supported, otherwise package vitest run."
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

### Task_3: Independent Review And Closeout
- type: review
- owns: []
- depends_on: [Task_2]
- description: |
  Run an independent review against acceptance criteria and validation evidence; fix findings until approved.
- acceptance:
  - Reviewer status is APPROVED.
  - No unresolved required findings remain.
  - Plan is moved to completed after validation and review pass.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent diff review against R14-H5 acceptance criteria."

## Task Waves
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]

## Rollback / Safety
- Revert the GitHub provider schema/test changes in one commit if downstream compatibility issues appear.

## Progress Log
- 2026-06-01 00:00 Wave 1 started: [Task_1]
  - Summary: Researcher dispatched; Orchestrator read target client/plugin/worker files and tests.
  - Validation evidence: In progress.
  - Notes: Existing `safeParse` is present but timestamp validation is too permissive.
- 2026-06-01 15:36 Wave 1 completed: [Task_1]
  - Summary: Researcher confirmed the remaining gap is timestamp strictness plus provider-level malformed user guard; worker common metadata-drop behavior is out of scope.
  - Validation evidence: Read-only review of target files and Researcher report.
  - Notes: No worker implementation change needed.
- 2026-06-01 15:36 Wave 2 in progress: [Task_2]
  - Summary: Added datetime validation for GitHub upstream timestamps and provider-level `GitHubUserInfoSchema` guard.
  - Validation evidence: `pnpm --filter @nexus-form/validation-provider-github test` passed, 5 files / 40 tests.
  - Notes: Full repo validation pending.
- 2026-06-01 15:54 Wave 2 completed: [Task_2]
  - Summary: Client now validates GitHub API timestamps as ISO datetimes before mapping, and plugin revalidates returned `GitHubUserInfo` before reporting success metadata.
  - Validation evidence:
    - `pnpm --filter @nexus-form/validation-provider-github test` passed, 5 files / 40 tests.
    - `pnpm lint:fix` passed, 9/9 tasks.
    - `pnpm type-check` passed, 16/16 tasks.
    - `pnpm test --silent` failed before test execution because Turbo 2.9 treats `--silent` as an unexpected turbo argument.
    - `pnpm test -- --silent` and `pnpm test -- --silent --testTimeout=120000 --hookTimeout=120000` exposed API hook timeouts under default Turbo parallelism; API alone passed with extended timeouts.
    - `pnpm test --concurrency=1 -- --silent --testTimeout=120000 --hookTimeout=120000` passed, 15/15 tasks.
  - Notes: No code change outside GitHub provider was required; timeout workaround is validation-only.
- 2026-06-01 15:54 Wave 3 started: [Task_3]
  - Summary: Preparing independent Reviewer packet.
  - Validation evidence: Pending Reviewer result.
  - Notes: Reviewer should check validation-boundary, contract, and test adequacy.
- 2026-06-01 15:54 Wave 3 completed: [Task_3]
  - Summary: Independent Reviewer returned APPROVED with no findings.
  - Validation evidence: Reviewer reran `pnpm --filter @nexus-form/validation-provider-github test` and confirmed 5 files / 40 tests passed; Reviewer also validated datetime schema behavior.
  - Notes: Residual worker metadata-drop behavior is accepted as out of scope because GitHub provider validates before returning success.

## Decision Log
- 2026-06-01 00:00 Decision: Execute without separate plan approval.
  - Trigger / new insight: User delegated implementation through PR/merge in this worker thread.
  - Plan delta: User approval gate waived for this task.
  - Tradeoffs considered: Proceeding avoids blocking the delegated end-to-end task while preserving plan and review gates.
  - User approval: waived by delegation.

## Notes
- Risks:
  - Overly strict URL/date validation could reject legitimate GitHub data; use documented ISO datetime strings and URL fields already expected by existing metadata.
- Edge cases:
  - `updated_at` should be validated consistently with `created_at`.
