# Plan: Response Analytics SQL Fix

- status: done
- generated: 2026-07-05
- last_updated: 2026-07-05
- work_type: code

## Goal
- Fix the production 500 on `GET /api/forms/:id/responses/analytics` caused by the timeline aggregate SQL.

## Definition of Done
- The analytics timeline query no longer relies on inconsistent raw SQL expression reuse for select/group/order.
- Existing pagination and error logging behavior remains covered.
- Required repository checks are run or explicitly reported if blocked.

## Scope / Non-goals
- Scope:
  - `apps/api/src/routes/forms-response-analytics.ts`
  - `apps/api/src/__tests__/unbounded-query-pagination.test.ts`
- Non-goals:
  - UI changes.
  - Database schema or migration changes.
  - Block analytics behavior changes.

## Context (workspace)
- Related files/areas:
  - `apps/api/src/routes/forms-response-analytics.ts`
  - `apps/api/src/__tests__/unbounded-query-pagination.test.ts`
- Existing patterns or references:
  - Existing route-local zod response parsing.
  - Existing bounded pagination tests for response analytics.
- Repo reference docs consulted:
  - `AGENTS.md` supplied instructions.
  - `$orchestration-harness`
  - `$plan-format`
  - `$engineering-quality-baselines`

## Open Questions
- Q1: None.

## Assumptions
- A1: The attached production log is the user request and indicates a bug to fix.
- A2: Keeping daily timeline pagination semantics is required.
- A3: Research waived: the failure is narrowly identified by the production stack trace and local source/test search; dispatching a separate Researcher would add little signal.

## Tasks

### Task_1: Stabilize analytics timeline SQL
- type: impl
- owns:
  - `apps/api/src/routes/forms-response-analytics.ts`
- depends_on: []
- description: |
  Adjust the timeline aggregation query so selected date, grouping, and ordering are generated consistently and remain MySQL-compatible.
- acceptance:
  - The query returns `timeline` rows with `date` and `count`.
  - The query preserves `page`, `pageSize`, `hasNext`, `offset`, and `limit(pageSize + 1)` behavior.
  - Error logging still includes MySQL driver detail keys when present.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `pnpm --filter @nexus-form/api exec vitest run src/__tests__/unbounded-query-pagination.test.ts`
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

### Task_2: Update regression expectations
- type: test
- owns:
  - `apps/api/src/__tests__/unbounded-query-pagination.test.ts`
- depends_on: [Task_1]
- description: |
  Update or add route-level test coverage for the safer SQL shape without weakening pagination assertions.
- acceptance:
  - The test verifies the query uses the stable daily aggregate shape.
  - Existing response body assertions remain intact.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: `pnpm --filter @nexus-form/api exec vitest run src/__tests__/unbounded-query-pagination.test.ts`

### Task_3: Review and closeout
- type: review
- owns: []
- depends_on: [Task_1, Task_2]
- description: |
  Review the final diff against the production error and validation evidence.
- acceptance:
  - Reviewer status is recorded by orchestrator self-review.
  - No unrelated files are modified except the execution plan lifecycle move.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: Diff review against acceptance criteria and attached log.

## Task Waves
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]

## Rollback / Safety
- Revert the route and test changes if the generated SQL fails validation.

## Progress Log
- 2026-07-05 00:00 Wave 0 started:
  - Summary: Production log and route/test locations identified.
  - Validation evidence: pending.
  - Notes: Repository rule files under `docs/coding-agent/rules/` are absent.
- 2026-07-05 01:46 Wave 1 completed: [Task_1]
  - Summary: Response analytics timeline date expression now uses a selected alias and orders with `desc(responseDate)`.
  - Validation evidence: targeted route test passed.
  - Notes: Local Drizzle dialect check showed the alias form generates `group by \`date\` order by \`date\` desc`.
- 2026-07-05 01:47 Wave 2 completed: [Task_2]
  - Summary: Updated route-level regression expectations for alias-based grouping and ordering.
  - Validation evidence: `pnpm --filter @nexus-form/api exec vitest run src/__tests__/unbounded-query-pagination.test.ts` passed.
  - Notes: Existing pagination and error logging assertions remain.
- 2026-07-05 01:50 Wave 3 completed: [Task_3]
  - Summary: Reviewed final diff against the attached production error.
  - Validation evidence: `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent` passed.
  - Notes: No UI/E2E validation required because this is API SQL generation only.

## Decision Log
- 2026-07-05 00:00 Decision:
  - Trigger / new insight: Attached production log shows `responses/analytics` failing at the daily aggregate query.
  - Plan delta: Scope limited to API timeline SQL generation and its route-level test.
  - Tradeoffs considered: No schema migration because the existing column exists as `submittedAt`.
  - User approval: no; proceeding under direct "read and act" request.

## Notes
- Risks:
  - MySQL function behavior and Drizzle SQL rendering can differ between mock tests and production; mitigated with a local Drizzle dialect SQL generation check.
- Edge cases:
  - Empty timelines must remain a successful response.
  - Extra row trimming must continue to drive `hasNext`.
