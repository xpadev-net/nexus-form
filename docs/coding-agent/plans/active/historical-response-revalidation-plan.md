# Plan: Historical Response Revalidation

- status: draft
- generated: 2026-07-06
- last_updated: 2026-07-06
- work_type: code

## Goal
- Allow form owners to rerun validation for past responses using the latest validation configuration and currently installed validation provider/plugin implementations.

## Definition of Done
- Admin API can enqueue revalidation for eligible historical responses.
- Worker reruns validation safely and records latest results without corrupting in-flight or previous result state.
- Deleted responses are excluded from revalidation.
- Web UI exposes a guarded revalidation action with clear pending/completed/error states.
- Required targeted tests, UI/E2E evidence, reviewer approval, and repository validation pass.

## Scope / Non-goals
- Scope:
  - `packages/shared/src/**`
  - `packages/database/src/**`
  - `apps/api/src/routes/forms-*.ts`
  - `apps/api/src/lib/forms/**`
  - `apps/api/src/__tests__/**`
  - `apps/worker/src/handlers/generic-validation.ts`
  - `apps/worker/src/handlers/__tests__/generic-validation.test.ts`
  - `apps/web/src/components/forms/**`
  - `apps/web/src/routes/**`
  - `apps/web/src/**/*.test.tsx`
- Non-goals:
  - No response deletion UI/API implementation; that is covered by `response-deletion-plan.md`.
  - No validation output export settings or CSV/Sheets columns; those are covered by `validation-result-export-plan.md`.
  - No automatic scheduled revalidation unless requested separately.
  - No performance tests.

## Context (workspace)
- Related files/areas:
  - Validation processing uses BullMQ provider queues and worker `generic-validation`.
  - Prior worker/provider validation patterns are shown in `docs/coding-agent/plans/completed/r23-t2-discord-validation-slice-plan.md`.
  - Deleted responses must be excluded once `docs/coding-agent/plans/active/response-deletion-plan.md` lands.
- Existing patterns or references:
  - API routes should define zod request/response schemas and export inferred response types.
  - Revalidation should reuse provider queues rather than bypassing worker validation behavior.
  - Web data fetching should use TanStack Query.
- Repo reference docs consulted:
  - `AGENTS.md` supplied instructions.
  - `$orchestration-harness`
  - `$plan-format`
  - Existing plans listed above.
- Repo rules:
  - `docs/coding-agent/rules/**` is absent in this worktree. Waiver: use AGENTS/CLAUDE instructions and harness skills directly for validation policy.

## Open Questions (max 3)
- Q1: Should the first UI/API slice support one response only, selected responses, all responses in a form, or all three?
- Q2: Should old validation results remain visible as history, or should the latest rerun supersede them in admin views?
- Q3: Should revalidation use the latest form validation settings even when the original response used an older form snapshot?

## Assumptions
- A1: "Latest validation" means current form validation configuration plus currently installed provider/plugin versions.
- A2: Revalidation should be idempotent by response id, block/component id, provider/kind, and run id.
- A3: Admin views should prefer latest completed validation results while still handling pending and failed reruns explicitly.
- A4: Deleted-response exclusion may initially be implemented defensively even before the response deletion plan lands.

## Tasks

### Task_1: Audit current validation result and queue semantics
- type: research
- owns:
  - `docs/coding-agent/plans/active/historical-response-revalidation-plan.md`
- depends_on: []
- description: |
  Inspect current validation result tables, result selection logic, provider queue payloads, SSE/status APIs, and admin validation UI before changing behavior.
- acceptance:
  - Existing validation result identity and latest-result selection are documented in this plan.
  - Revalidation scope decision is recorded for one/selected/all response support.
  - Deleted-response exclusion points are mapped.
  - Required migration vs JSON-only/state-only change is identified before implementation.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "Plan updated with current validation queue/result semantics and selected revalidation scope."

### Task_2: Add revalidation API contract and enqueue logic
- type: impl
- owns:
  - `packages/shared/src/**`
  - `packages/database/src/**`
  - `apps/api/src/routes/forms-*.ts`
  - `apps/api/src/lib/forms/**`
  - `apps/api/src/__tests__/**`
- depends_on: [Task_1]
- description: |
  Add owner-authorized API endpoints and services to enqueue revalidation jobs for the selected scope.
- acceptance:
  - API validates revalidation scope and target response ids.
  - Only authorized form owners/editors can enqueue revalidation.
  - Deleted, missing, unauthorized, and ineligible responses are excluded with stable results.
  - Jobs are enqueued only for eligible response fields and enabled validation providers.
  - Tests cover auth, scope selection, enqueue payloads, and deleted-response exclusion.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/*validation*.test.ts src/__tests__/forms-responses*.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review API contract, tenant isolation, and enqueue idempotency."

### Task_3: Implement worker rerun state handling
- type: impl
- owns:
  - `apps/worker/src/handlers/generic-validation.ts`
  - `apps/worker/src/handlers/__tests__/generic-validation.test.ts`
  - `packages/shared/src/**`
  - `packages/database/src/**`
- depends_on: [Task_2]
- description: |
  Make worker reruns distinguish pending/current/latest results and avoid conflicting writes when rerun requests overlap.
- acceptance:
  - Rerun jobs produce a latest result without corrupting existing historical rows.
  - In-flight duplicate jobs are deduped, ignored, or ordered according to the Task_1 decision.
  - Failed and retryable reruns leave admin-visible state consistent.
  - Deleted responses are ignored safely if deletion happens after enqueue.
  - Tests cover latest-result selection, duplicate reruns, retry behavior, and deleted-after-enqueue behavior.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review rerun idempotency, latest-result semantics, and queue safety."

### Task_4: Add revalidation UI flow
- type: impl
- owns:
  - `apps/web/src/components/forms/**`
  - `apps/web/src/routes/**`
  - `apps/web/src/**/*.test.tsx`
- depends_on: [Task_2, Task_3]
- description: |
  Add admin UI controls for revalidation with clear pending, completed, failed, and partial states.
- acceptance:
  - Revalidation action is visible only on authorized response management surfaces.
  - UI reflects queued/pending/completed/failed states without stale optimistic success.
  - Query invalidation or SSE updates refresh validation results after completion.
  - Component tests cover confirm/start, pending, success, failure, and deleted-response cases.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run historical revalidation UI flow using the E2E spec below."
  - kind: review
    required: true
    owner: reviewer
    detail: "Review UX states, query/SSE refresh behavior, and mobile/desktop layout."

### Task_5: Full validation and review
- type: review
- owns: []
- depends_on: [Task_4]
- description: |
  Run repository-required validation and independent review for the revalidation slice.
- acceptance:
  - Required repo commands pass or failures are documented with root cause and owner.
  - Reviewer approves the complete revalidation change.
  - Browser evidence covers start, pending, completed, failed, and deleted-response handling.
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
    detail: "Independent final review with attention to queue semantics, latest-result correctness, and UI regressions."

## Task Waves (explicit parallel dispatch sets)

- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]
- Wave 4 (parallel): [Task_4]
- Wave 5 (parallel): [Task_5]

## E2E / Visual Validation Spec

- provider: playwright-cli
- artifact_root: `.playwright-cli/historical-response-revalidation/`
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev`
- readiness_check: "Web app responds on port 3000 and API responds on port 3001."
- flows:
  - Open a historical response detail as a form owner.
  - Trigger revalidation and verify queued/pending state.
  - Complete mocked validation and verify latest result updates.
  - Trigger a failure fixture and verify failed state.
  - Verify deleted or missing response cannot be revalidated.
- viewports:
  - desktop: 1440x900
  - mobile: 390x844
- evidence_requirements:
  - Screenshots for action state, pending state, updated result, failed result, and mobile layout.
  - Console and network errors summarized.
- known_flakiness:
  - Use deterministic provider fixtures; avoid real Discord/GitHub/Twitter credentials.

## Rollback / Safety
- Keep revalidation owner-authorized.
- Preserve old validation result compatibility.
- Rerun jobs must be idempotent and must ignore deleted responses.
- If current schema cannot represent latest vs historical results safely, replan before implementation continues.

## Progress Log

- 2026-07-06 Draft created from split of `response-management-validation-export-plan.md`.
  - Summary: Isolated historical revalidation from deletion and validation-result export work.
  - Validation evidence: Not run; planning only.
  - Notes: Repository rule suite is absent.

## Decision Log

- 2026-07-06 Decision:
  - Trigger / new insight: User requested splitting the umbrella response management/validation/export plan.
  - Plan delta: Created a dedicated historical response revalidation plan with API, worker, and UI slices.
  - Tradeoffs considered: Bundling with validation export would delay revalidation behind plugin output contract decisions.
  - User approval: yes

## Notes
- Risks:
  - Latest-result selection can be ambiguous if current schema only stores one row per response/provider.
  - Bulk/all-response reruns can be expensive and need batching.
- Edge cases:
  - Response deleted after enqueue.
  - Provider config changed since original submission.
  - Form blocks removed or renamed since original submission.
  - Duplicate rerun requests for the same response.
