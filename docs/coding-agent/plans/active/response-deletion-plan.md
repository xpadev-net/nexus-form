# Plan: Response Deletion

- status: draft
- generated: 2026-07-06
- last_updated: 2026-07-06
- work_type: code

## Goal
- Allow form owners to delete submitted responses from the web UI while keeping response reads, analytics, validation state, CSV export, and Sheets sync consistent.

## Definition of Done
- Response list/detail UI exposes a guarded delete action for authorized form owners.
- API deletes or tombstones a response through a zod-validated, owner-authorized route.
- Deleted responses no longer appear in response list/detail, analytics, CSV export, Sheets sync, or revalidation candidates.
- Dependent validation/job/export state is cleaned up or hidden consistently.
- Required targeted tests, UI/E2E evidence, reviewer approval, and repository validation pass.

## Scope / Non-goals
- Scope:
  - `packages/database/src/**`
  - `packages/shared/src/**`
  - `apps/api/src/routes/forms-responses*.ts`
  - `apps/api/src/lib/forms/**`
  - `apps/api/src/__tests__/**`
  - `apps/web/src/components/forms/**`
  - `apps/web/src/routes/**`
  - `apps/web/src/types/**`
  - `apps/web/src/**/*.test.tsx`
  - export/sheets tests only where needed to prove deleted responses are excluded
- Non-goals:
  - No historical revalidation implementation; that is covered by `historical-response-revalidation-plan.md`.
  - No validation output column design; that is covered by `validation-result-export-plan.md`.
  - No performance tests.

## Context (workspace)
- Related files/areas:
  - Response export and Sheets share output behavior from `docs/coding-agent/plans/completed/response-export-sheets-unification-plan.md`.
  - Future revalidation must exclude deleted responses; see `docs/coding-agent/plans/active/historical-response-revalidation-plan.md`.
- Existing patterns or references:
  - API routes should define zod request/response schemas and export inferred response types for frontend reuse.
  - Web data fetching should use TanStack Query and invalidate related response/export/analytics queries after mutation.
  - UI changes require reviewer-owned E2E/visual validation.
- Repo reference docs consulted:
  - `AGENTS.md` supplied instructions.
  - `$orchestration-harness`
  - `$plan-format`
  - Existing plans listed above.
- Repo rules:
  - `docs/coding-agent/rules/**` is absent in this worktree. Waiver: use AGENTS/CLAUDE instructions and harness skills directly for validation policy.

## Open Questions (max 3)
- Q1: Should deletion be a hard delete, or should it be a soft delete/audit-preserving tombstone?
- Q2: Should repeated delete return success/idempotent empty state or a not-found style response?
- Q3: Should existing synced Google Sheets rows be removed, left as historical external copies, or marked deleted only in future sync output?

## Assumptions
- A1: Initial implementation can use a guarded hard delete if existing schema constraints allow dependent data to be removed transactionally; otherwise Task_1 must replan to soft delete.
- A2: Deleted responses should be excluded from future exports/syncs, but already-written external Sheets rows are not physically removed unless the product decision in Q3 says otherwise.
- A3: Direct navigation to a deleted response detail should show the same non-leaky not-found behavior used for unauthorized/missing responses.

## Tasks

### Task_1: Audit deletion dependencies and choose delete semantics
- type: research
- owns:
  - `docs/coding-agent/plans/active/response-deletion-plan.md`
- depends_on: []
- description: |
  Inspect response schema, validation result schema, response routes, analytics queries, export helpers, Sheets sync, and response management UI. Decide hard delete vs soft delete before implementation.
- acceptance:
  - Response foreign-key/dependency graph is documented in this plan.
  - Hard delete vs soft delete decision is recorded with tradeoffs.
  - Required migration, if any, is identified before implementation starts.
  - Exclusion points for list/detail/analytics/export/Sheets are mapped.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "Plan updated with deletion dependency map and delete/tombstone decision."

### Task_2: Implement authorized response delete API
- type: impl
- owns:
  - `packages/database/src/**`
  - `packages/shared/src/**`
  - `apps/api/src/routes/forms-responses*.ts`
  - `apps/api/src/lib/forms/**`
  - `apps/api/src/__tests__/**`
- depends_on: [Task_1]
- description: |
  Add owner-authorized response deletion and make response reads consistently exclude deleted responses.
- acceptance:
  - Only authorized form owners/editors can delete a response.
  - Unknown, cross-tenant, unauthorized, and deleted responses return stable non-leaky errors.
  - Dependent validation result/job state is cleaned up or hidden according to Task_1.
  - Response list/detail/read APIs no longer return deleted responses.
  - Tests cover auth, cross-tenant access, dependency cleanup, and repeated delete behavior.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-responses*.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review authorization, data consistency, and delete/tombstone semantics."

### Task_3: Exclude deleted responses from derived outputs
- type: impl
- owns:
  - `apps/api/src/lib/forms/response-export.ts`
  - `apps/api/src/routes/forms-response-analytics.ts`
  - `apps/api/src/__tests__/response-export.test.ts`
  - `apps/api/src/__tests__/*analytics*.test.ts`
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/worker/src/handlers/__tests__/sheets-sync.test.ts`
- depends_on: [Task_2]
- description: |
  Ensure analytics, CSV export, and Sheets sync do not include deleted responses.
- acceptance:
  - CSV export omits deleted responses.
  - Analytics counts and timelines omit deleted responses.
  - Sheets sync does not enqueue or write deleted responses in future runs.
  - Existing external rows are handled according to the Task_1/Q3 decision.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/response-export.test.ts src/__tests__/*analytics*.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/sheets-sync.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review deleted-response exclusion across derived outputs."

### Task_4: Add response deletion UI
- type: impl
- owns:
  - `apps/web/src/components/forms/**`
  - `apps/web/src/routes/**`
  - `apps/web/src/types/**`
  - `apps/web/src/**/*.test.tsx`
- depends_on: [Task_2]
- description: |
  Add delete actions to response list/detail surfaces with confirmation, pending/error states, and query invalidation.
- acceptance:
  - Delete action is visible only on owner/admin response management surfaces.
  - Confirmation identifies the target response without exposing unsafe user content.
  - Successful deletion removes the response from list/detail state and invalidates related analytics/export queries.
  - Failure states are visible and do not leave the UI in a false-deleted state.
  - Component tests cover confirm, cancel, success, and failure paths.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run response delete UI flow using the E2E spec below."
  - kind: review
    required: true
    owner: reviewer
    detail: "Review UX states, query invalidation, and mobile/desktop layout."

### Task_5: Full validation and review
- type: review
- owns: []
- depends_on: [Task_3, Task_4]
- description: |
  Run repository-required validation and independent review for the deletion slice.
- acceptance:
  - Required repo commands pass or failures are documented with root cause and owner.
  - Reviewer approves the complete deletion change.
  - Browser evidence covers delete confirmation, post-delete list, and deleted detail behavior.
- validation:
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
    detail: "pnpm test -- --silent"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent final review with attention to auth, data integrity, and UI regressions."

## Task Waves (explicit parallel dispatch sets)

- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3, Task_4]
- Wave 4 (parallel): [Task_5]

## E2E / Visual Validation Spec

- provider: playwright-cli
- artifact_root: `.playwright-cli/response-deletion/`
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev`
- readiness_check: "Web app responds on port 3000 and API responds on port 3001."
- flows:
  - Open a form response list.
  - Trigger delete, cancel, and verify no change.
  - Trigger delete, confirm, and verify the response disappears.
  - Navigate directly to the deleted response detail and verify not-found/non-leaky handling.
  - Verify analytics/export affordances refresh or invalidate after deletion.
- viewports:
  - desktop: 1440x900
  - mobile: 390x844
- evidence_requirements:
  - Screenshots for delete confirmation, post-delete list, deleted detail behavior, and mobile layout.
  - Console and network errors summarized.
- known_flakiness:
  - Use seeded or mocked responses; avoid external provider calls.

## Rollback / Safety
- If hard delete proves unsafe, replan to soft delete before implementation continues.
- Keep deletion behind owner/editor authorization checks.
- Do not physically alter existing external Google Sheets rows unless explicitly decided in Task_1.

## Progress Log

- 2026-07-06 Draft created from split of `response-management-validation-export-plan.md`.
  - Summary: Isolated web/API response deletion from revalidation and validation export work.
  - Validation evidence: Not run; planning only.
  - Notes: Repository rule suite is absent.

## Decision Log

- 2026-07-06 Decision:
  - Trigger / new insight: User requested splitting the umbrella response management/validation/export plan.
  - Plan delta: Created a dedicated response deletion plan with independent UI/API/export exclusion validation.
  - Tradeoffs considered: Keeping deletion bundled with revalidation would complicate review and rollback.
  - User approval: yes

## Notes
- Risks:
  - Existing foreign keys may require soft delete or explicit dependent cleanup.
  - Sheets rows already written outside the app may not be safely removable.
- Edge cases:
  - Deleted responses with in-flight validation jobs.
  - Repeated deletion.
  - Direct detail navigation after deletion.
  - Export or analytics caches that still include deleted responses.
