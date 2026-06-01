# Plan: R15-M6 Query Retry 4xx Handling

- status: done
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal
- Ensure web data-fetching retries skip client-side HTTP errors and only retry server/network failures.

## Definition of Done
- TanStack Query or shared fetch/API retry classification treats 4xx responses as non-retryable.
- 5xx and network failures remain retryable under the existing retry policy.
- Existing UI error paths receive the error immediately after a 4xx response.
- Focused tests cover retry classification.
- Required repository checks pass or any environment failure is recorded.

## Scope / Non-goals
- Scope:
  - `apps/web/src` query/client/API error handling.
  - Tests for web retry behavior.
- Non-goals:
  - Backend API behavior changes.
  - Redesign of UI error displays.
  - Edits to `docs/coding-agent/lessons.md`.

## Context (workspace)
- Related files/areas:
  - `apps/web/src/lib/api.ts`
  - `apps/web/src/**/*`
- Existing patterns or references:
  - Researcher context requested for current QueryClient and API error patterns.
- Repo reference docs consulted:
  - `/Users/xpadev/.codex/RTK.md`
  - `AGENTS.md` instructions from task prompt
  - `orchestration-harness`
  - `plan-format`
- Repo rule suite:
  - `docs/coding-agent/rules` is absent in this worktree; proceeding with AGENTS/task instructions.

## Open Questions (max 3)
- None currently.

## Assumptions
- The existing shared query client is the lowest-risk place to centralize retry classification.
- Tests can validate retry behavior without browser E2E because this is data-fetching behavior, not layout.

## Tasks

### Task_1: Research current retry and error patterns
- type: research
- owns: []
- depends_on: []
- description: |
  Identify query client setup, API error type/status access, existing retry overrides, and natural test location.
- acceptance:
  - Query retry defaults location is identified.
  - Existing API error status shape is identified.
  - Relevant test pattern is identified.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "Researcher report reviewed before implementation"

### Task_2: Implement retry classification
- type: impl
- owns:
  - apps/web/src/lib/**
  - apps/web/src/hooks/**
  - apps/web/src/**/*.test.ts
  - apps/web/src/**/*.test.tsx
- depends_on: [Task_1]
- description: |
  Add shared retry logic so 4xx errors fail immediately while 5xx and network errors remain retryable.
- acceptance:
  - 4xx HTTP errors return false from retry classification.
  - 5xx HTTP errors remain retryable according to existing retry count.
  - Unknown/network errors remain retryable according to existing retry count.
  - Calling code can still access existing error details for immediate display.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Focused web tests for retry classification"

### Task_3: Repository validation
- type: test
- owns: []
- depends_on: [Task_2]
- description: |
  Run required repo checks from AGENTS.
- acceptance:
  - `pnpm lint:fix` completes.
  - `pnpm type-check` completes.
  - `pnpm test --silent` completes, or documented fallback `pnpm test -- --silent` is used if Turbo rejects the first form.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "Run required validation commands from repository root"

### Task_4: Independent review
- type: review
- owns: []
- depends_on: [Task_3]
- description: |
  Independently review implementation and validation evidence against R15-M6 acceptance criteria.
- acceptance:
  - Reviewer status is APPROVED or all findings are resolved and re-reviewed.
  - Reviewer confirms no 4xx retry regression remains.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent reviewer report"

## Task Waves (explicit parallel dispatch sets)

- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]
- Wave 4 (parallel): [Task_4]

## E2E / Visual Validation Spec

- provider: n/a
- artifact_root: n/a
- base_url: n/a
- app_start_command: n/a
- readiness_check: n/a
- flows: n/a; data-fetching retry logic is covered by unit tests.
- viewports: n/a
- evidence_requirements: n/a
- known_flakiness: n/a

## Rollback / Safety
- Revert the shared retry classification and its tests.

## Progress Log (append-only)

- 2026-06-01 00:00 Wave 1 started: [Task_1]
  - Summary: Researcher dispatched to identify retry/error/test patterns.
  - Validation evidence: Pending.
  - Notes: User approval waived because the user explicitly delegated implementation through merge.
- 2026-06-01 16:32 Wave 1 completed: [Task_1]
  - Summary: Researcher found shared retry logic in `apps/web/src/lib/query-retry.ts`, default wiring in `root-provider.tsx`, and an uncovered `HttpError` path from `fetchJson`.
  - Validation evidence: Researcher report status `FOUND`.
  - Notes: Proceeded with `HttpError` support because task scope includes fetch layer.
- 2026-06-01 16:33 Wave 2 completed: [Task_2]
  - Summary: Retry status extraction now works for any thrown error with numeric HTTP `status`; tests cover `RpcError`, `HttpError`, server errors, and network errors.
  - Validation evidence: `rtk pnpm --filter @nexus-form/web exec vitest run src/lib/query-retry.test.ts src/integrations/tanstack-query/root-provider.test.ts` passed, 2 files / 4 tests.
  - Notes: Orchestrator removed a type assertion during integration.
- 2026-06-01 16:36 Wave 3 completed: [Task_3]
  - Summary: Required repository validation completed.
  - Validation evidence: `rtk pnpm lint:fix` passed; `rtk pnpm type-check` passed; `rtk pnpm test --silent` failed because Turbo rejected the argument; fallback `rtk pnpm test -- --silent` passed, 15 tasks successful.
  - Notes: `rtk git diff --check` passed.
- 2026-06-01 16:37 Wave 4 completed: [Task_4]
  - Summary: Independent Reviewer approved the implementation with no findings.
  - Validation evidence: Reviewer status `APPROVED`; reviewer re-ran focused tests and `rtk git diff --check`.
  - Notes: Ready for commit and PR flow.
- 2026-06-01 16:48 PR review hook follow-up completed
  - Summary: Greptile flagged broad status duck typing and 429 semantics. Status extraction was narrowed to `RpcError` / `HttpError`, and 429 immediate-error behavior was documented as intentional for R15-M6.
  - Validation evidence: `rtk pnpm --filter @nexus-form/web exec vitest run src/lib/query-retry.test.ts src/integrations/tanstack-query/root-provider.test.ts` passed, 2 files / 6 tests.
  - Notes: Awaiting base branch merge and final `gh-review-hook` rerun.

## Decision Log (append-only; re-plans and major discoveries)

- 2026-06-01 00:00 Decision:
  - Trigger / new insight: Task is behavioral and spans implementation plus validation.
  - Plan delta (what changed): Created harness plan and marked in progress.
  - Tradeoffs considered: Direct implementation vs harness workflow.
  - User approval: waived; implementation through merge was explicitly delegated.

## Notes
- Risks:
  - If API errors do not consistently expose status, retry classification may need a narrow helper.
- Edge cases:
  - Network errors without status should continue through retry policy.
