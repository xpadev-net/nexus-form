# Plan: Prefill Reachability Validation

- status: in_progress
- generated: 2026-07-06
- last_updated: 2026-07-08
- work_type: code

## Goal
- Fix issue 13: prevent prefill URLs and public submissions from carrying answers for fields that are not reachable through normal form navigation/branching.

## Definition of Done
- Backend recomputes reachable questions from the published Plate snapshot and submitted answers.
- Public submit rejects responses for unreachable questions, even if a crafted prefill URL or request payload includes them.
- Prefill URL generation excludes values for questions that cannot be reached from the generated prefill state.
- Frontend and backend use the same shared reachability helper so branching semantics stay aligned.
- Required targeted tests plus repo validation pass.

## Scope / Non-goals
- Scope:
  - `packages/shared/src/plate-content-utils.ts`
  - `packages/shared/src/forms/condition-evaluator.ts`
  - `packages/shared/src/__tests__/plate-content-utils.test.ts`
  - `apps/web/src/hooks/forms/use-form-paging.ts`
  - `apps/web/src/lib/forms/prefill.ts`
  - `apps/web/src/lib/forms/prefill.test.ts`
  - `apps/web/src/components/forms/form-prefill-generator.tsx`
  - `apps/web/src/components/forms/form-prefill-generator.test.tsx`
  - `apps/web/src/components/forms/public-form-page.tsx`
  - `apps/web/src/components/forms/public-form-page.test.tsx`
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/lib/forms/response-validator.ts`
  - `apps/api/src/lib/forms/plate-question-builder.ts`
  - `apps/api/src/__tests__/forms-public-validation-outbox.test.ts`
  - `apps/api/src/__tests__/authz-regression.test.ts`
  - `apps/api/src/__tests__/response-validator.test.ts`
- Non-goals:
  - No performance tests.
  - No change to prefill encoding format unless unavoidable.
  - No retroactive cleanup of already stored responses.

## Context (workspace)
- `FormPrefillGenerator` filters by supported question type, but does not account for section/page branching reachability.
- `decodePrefillData` validates shape only; it does not know the form structure.
- `useFormPaging.ts` has client-side `resolveReachablePageIndexes`, but it lives in `apps/web` and is not available to API validation.
- Public submit accepts `responses` and uses snapshot-derived questions for type/value validation, but does not currently validate that each submitted question is reachable from normal navigation.
- `FormBody` submits `visitedQuestionIds`, but the public submit schema currently does not include that field in the shown route schema, so the API cannot trust or enforce client-visited state without a server recomputation path.
- Security finding #20 from `codex-security-findings-2026-07-05T17-52-07.258Z.csv` overlaps this plan: `includes_any` / `includes_all` rules can match missing values on unanswered questions, which would make reachability decisions incorrect.
- Repo rule suite is absent: `docs/coding-agent/rules` does not exist.

## Open Questions (max 3)
- Q1: Should backend reject unreachable submitted answers with `400 Invalid response data`, or silently drop them before persistence?
- Q2: Should generated prefill URLs warn the editor when a value was removed due to reachability, or simply exclude it?
- Q3: For branch conditions depending on a question that is itself prefilled, should prefill generation recompute reachability live as each value changes? Assumption: yes.

## Assumptions
- A1: Backend should reject unreachable submitted answers rather than silently dropping them, because crafted requests should be visible as invalid.
- A2: Prefill generation should only include answers that are reachable from the current prefill answers and normal page flow.
- A3: Shared reachability logic should be based on Plate pages and `evaluateRule` so frontend and backend branching semantics match.

## Tasks

### Task_1: Move reachability calculation into shared code
- type: impl
- owns:
  - `packages/shared/src/plate-content-utils.ts`
  - `packages/shared/src/forms/condition-evaluator.ts`
  - `packages/shared/src/__tests__/plate-content-utils.test.ts`
  - `apps/web/src/hooks/forms/use-form-paging.ts`
- depends_on: []
- description: |
  Extract the page/action reachability logic from `use-form-paging.ts` into a shared helper that accepts Plate pages and answer-like values.
- acceptance:
- Shared helper returns reachable page indexes and question ids from Plate pages and response records.
- Frontend `useFormPaging` delegates to the shared helper.
- Loop/cycle protection remains in place.
- `includes_any` and `includes_all` do not match missing/unanswered values.
- Shared tests cover next, jump_to_section, submit target, and branch-dependent reachability.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/shared exec vitest run src/__tests__/plate-content-utils.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/hooks/forms/use-form-paging.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review parity with existing frontend navigation semantics."

### Task_2: Validate prefill generation against reachability
- type: impl
- owns:
  - `apps/web/src/lib/forms/prefill.ts`
  - `apps/web/src/lib/forms/prefill.test.ts`
  - `apps/web/src/components/forms/form-prefill-generator.tsx`
  - `apps/web/src/components/forms/form-prefill-generator.test.tsx`
- depends_on: [Task_1]
- description: |
  Filter generated prefill data by both supported type and computed reachability, updating preview copy so editors know which configured values are included.
- acceptance:
  - Prefill URL excludes unreachable question values.
  - Reachability recomputes when a prefilled branch-controlling answer changes.
  - Preview separates included, unsupported, empty, and unreachable questions.
  - Tests cover a branch question where an unreachable answer would otherwise be encoded.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/lib/forms/prefill.test.ts src/components/forms/form-prefill-generator.test.tsx"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run prefill generator branching flow and verify unreachable values are not encoded."

### Task_3: Reject unreachable answers on public submit
- type: impl
- owns:
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/lib/forms/response-validator.ts`
  - `apps/api/src/lib/forms/plate-question-builder.ts`
  - `apps/api/src/__tests__/forms-public-validation-outbox.test.ts`
  - `apps/api/src/__tests__/authz-regression.test.ts`
  - `apps/api/src/__tests__/response-validator.test.ts`
  - `apps/web/src/components/forms/public-form-page.tsx`
  - `apps/web/src/components/forms/public-form-page.test.tsx`
- depends_on: [Task_1]
- description: |
  During public submission, build a response record from payload answers, recompute reachable question ids from the published Plate content, and reject any submitted response whose question id is not reachable.
- acceptance:
  - Crafted payloads with unreachable branch answers are rejected before persistence, notifications, validation jobs, and Sheets sync enqueue.
  - Legitimate visited branch submissions still pass.
  - Submit target completion page behavior remains valid.
  - Client-provided visited ids are not trusted as the source of truth for reachability.
  - Error logging does not leak sensitive answer values.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-public-validation-outbox.test.ts src/__tests__/authz-regression.test.ts src/__tests__/response-validator.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/public-form-page.test.tsx"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review fail-closed behavior, ordering before persistence/background jobs, and privacy-safe logs."

### Task_4: Full validation and security review
- type: review
- owns: []
- depends_on: [Task_2, Task_3]
- description: |
  Run repo-required validation and review the full prefill/public-submit path for crafted URL/request bypasses.
- acceptance:
  - Required repo commands pass or failures are documented with root cause and owner.
  - Reviewer approves reachability parity between frontend and backend.
  - No bypass remains for unsupported, unreachable, or type-invalid prefill/request values.
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
    detail: "pnpm test --silent"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent security/data-integrity review of prefill generation and public submit validation."

## Task Waves
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2, Task_3]
- Wave 3 (parallel): [Task_4]

## E2E / Visual Validation Spec
- provider: playwright-cli
- artifact_root: `.playwright-cli/prefill-reachability-validation/`
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev`
- readiness_check: "Web app responds on port 3000 and API responds on port 3001."
- flows:
  - Build a form with a branch-controlling question and branch-only target question.
  - Generate a prefill URL with a branch answer that makes one target reachable and another unreachable.
  - Verify the prefill preview excludes or marks the unreachable value and the URL does not encode it.
  - Open the generated public URL and verify only reachable answers are prefilled.
  - Submit a crafted request including an unreachable answer and verify API rejects it without persistence.
  - Submit a valid reachable branch answer and verify success.
- viewports:
  - desktop: 1440x900
  - mobile: 390x844
- evidence_requirements:
  - Screenshots of prefill included/unreachable preview states.
  - Network evidence for rejected crafted submit and accepted valid submit.
  - Console errors checked and summarized.
- known_flakiness:
  - Crafted submit should use direct API request or deterministic browser fixture rather than timing-dependent UI state.

## Rollback / Safety
- Keep shape/type validation independent from reachability validation so existing error handling remains clear.
- If shared extraction becomes too large, add a small shared reachability module instead of duplicating logic in API and Web.
- Reject unreachable answers before any side effects.

## Progress Log
- 2026-07-06 Draft created.
  - Summary: Planned shared reachability helper, prefill generation filtering, backend public submit rejection, and security review.
  - Validation evidence: Not run; planning only.
  - Notes: This is separate from copy feedback because it affects trust boundaries and backend data integrity.
- 2026-07-06 Draft updated.
  - Summary: Added security finding #20 as a condition-evaluator correctness constraint.
  - Validation evidence: Not run; planning only.
  - Notes: Detailed remediation tracking lives in `security-findings-remediation-plan.md`.
- 2026-07-08 Work started.
  - Summary: Dispatched PREFILL-1 worker for the shared reachability helper and frontend paging parity.
  - Validation evidence: Pending worker validation.
  - Notes: Worker pending worktree `local:3e7b16ef-b3b5-4316-be9b-e5d18f9c3220`, branch `codex/prefill-reachability-core`.

## Decision Log
- 2026-07-06 Decision:
  - Trigger / new insight: Prefill URLs can be crafted or generated with values for fields unreachable through normal branch flow.
  - Plan delta: Added a dedicated prefill reachability/security plan instead of folding into copy feedback or validation-output plans.
  - Tradeoffs considered: Frontend-only filtering would improve generated URLs but would not stop crafted requests; backend recomputation is required.
  - User approval: no

## Notes
- Risks:
  - Backend reachability must match frontend navigation exactly to avoid rejecting legitimate submissions.
  - Branches depending on prefilled values require live recomputation during URL generation.
  - Existing tests may need fixture updates where they include branch answers not reachable under the submitted values.
