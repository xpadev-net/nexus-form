# Plan: Pattern And Other Validation Outputs

- status: in_progress
- generated: 2026-07-06
- last_updated: 2026-07-08
- work_type: code

## Goal
- Fix issues 5 and 6: make short-text pattern validation support block/warn/hidden modes, expose match status in responses/CSV/Sheets for non-blocking modes, and apply short-text-equivalent validation to choice `other` inputs.

## Definition of Done
- Shared validation schema supports `patternMismatchMode: "block" | "warn" | "hidden"` with legacy compatibility.
- `warn` and `hidden` do not block submission, but API computes/stores match metadata.
- Response pages, CSV, and Sheets expose match/mismatch status.
- Radio/dropdown/checkbox other text supports required/length/pattern/template rules.
- Frontend and API validation behavior align.

## Scope / Non-goals
- Scope:
  - `packages/shared/src/forms/form-block.ts`
  - `packages/shared/src/response-data.ts`
  - `packages/shared/src/response-export.ts`
  - `apps/api/src/lib/forms/response-validator.ts`
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/routes/forms-responses.ts`
  - `apps/api/src/lib/forms/response-export.ts`
  - `apps/api/src/lib/forms/block-validation.ts`
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/web/src/utils/validation/question-validators.ts`
  - `apps/web/src/components/editor/plugins/form-questions/**`
  - `apps/web/src/components/forms/form-body.tsx`
  - `apps/web/src/components/forms/response-display.tsx`
  - `apps/web/src/components/forms/response-detail-view.tsx`
  - related tests in shared/api/worker/web
- Non-goals:
  - No performance tests.
  - No retroactive recomputation for old responses unless explicitly requested later.

## Context (workspace)
- Current shared schema has boolean `allowPatternMismatch`.
- API and frontend skip short-text pattern rejection when `allowPatternMismatch` is true.
- Choice other text currently only checks presence when selected.
- Response export and Sheets output use shared export helpers, so output metadata should be added there.
- Security finding #14 from `codex-security-findings-2026-07-05T17-52-07.258Z.csv` overlaps this plan: blur validation can run unsafe regex patterns and create client-side ReDoS risk.
- Repo rule suite is absent: `docs/coding-agent/rules` does not exist.

## Open Questions (max 3)
- Q1: Should match status export columns be one column per question (`<title> Pattern Match`) or included in structured cell text?
- Q2: For `hidden`, should admins see mismatch status on response detail immediately even though respondents saw no warning?
- Q3: For checkbox other values, should one mismatch mark the whole question mismatched or expose per-other-value details?

## Assumptions
- A1: Legacy `allowPatternMismatch: false` maps to `block`; `true` maps to `hidden` unless product copy chooses `warn`.
- A2: Match metadata can be stored in response JSON without a DB migration unless implementation proves otherwise.
- A3: Unsafe regex handling remains conservative for blocking mode.

## Tasks

### Task_1: Extend shared schemas and helpers
- type: impl
- owns:
  - `packages/shared/src/forms/form-block.ts`
  - `packages/shared/src/response-data.ts`
  - `packages/shared/src/response-export.ts`
  - `packages/shared/src/__tests__/**`
- depends_on: []
- description: |
  Add pattern mode, other text validation schema, and response/export metadata types.
- acceptance:
  - Three pattern modes parse and type-check.
  - Legacy boolean config is normalized.
  - Choice `otherTextValidation` reuses short-text-compatible rules.
  - Export metadata types can represent match/mismatch/unchecked.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/shared test"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review backwards compatibility and type safety."

### Task_2: Align API and frontend validation behavior
- type: impl
- owns:
  - `apps/api/src/lib/forms/response-validator.ts`
  - `apps/api/src/lib/forms/block-validation.ts`
  - `apps/api/src/__tests__/response-validator.test.ts`
  - `apps/api/src/__tests__/block-validation.test.ts`
  - `apps/web/src/utils/validation/question-validators.ts`
  - `apps/web/src/components/editor/plugins/form-questions/**`
  - `apps/web/src/components/forms/form-body.tsx`
  - `apps/web/src/utils/validation/question-validators.test.ts`
  - `apps/web/src/components/editor/plate-editor-internal.test.tsx`
- depends_on: [Task_1]
- description: |
  Enforce block mode, warn in warn mode, hide respondent warnings in hidden mode, and validate choice other text.
- acceptance:
- Block mode rejects mismatches in UI and API.
- Warn mode allows submit with visible warning.
- Hidden mode allows submit without respondent warning.
- Blur/inline validation uses the same safe-regex guard as submit validation and skips or reports unsafe patterns without running them.
- Radio/dropdown/checkbox other text uses configured validation.
- API and frontend tests cover aligned behavior.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/response-validator.test.ts src/__tests__/block-validation.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/utils/validation/question-validators.test.ts src/components/editor/plate-editor-internal.test.tsx"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review respondent-visible vs admin-visible behavior."

### Task_3: Persist and expose match metadata in responses, CSV, and Sheets
- type: impl
- owns:
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/routes/forms-responses.ts`
  - `apps/api/src/lib/forms/response-export.ts`
  - `apps/api/src/__tests__/forms-public-validation-outbox.test.ts`
  - `apps/api/src/__tests__/response-export.test.ts`
  - `apps/web/src/components/forms/response-display.tsx`
  - `apps/web/src/components/forms/response-detail-view.tsx`
  - `apps/web/src/components/forms/response-export.tsx`
  - `apps/web/src/components/forms/response-detail-view.test.tsx`
  - `apps/web/src/components/forms/response-export.test.tsx`
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/worker/src/handlers/__tests__/sheets-sync.test.ts`
- depends_on: [Task_1, Task_2]
- description: |
  Compute server-side match status and include it in admin response views and export/sync output.
- acceptance:
  - Server computes match status from snapshot validation, not client trust.
  - Response detail shows match/mismatch for configured non-blocking values.
  - CSV and Sheets output include stable match status data.
  - Export behavior handles unknown/unsafe regex without crashing.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-public-validation-outbox.test.ts src/__tests__/response-export.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/response-detail-view.test.tsx src/components/forms/response-export.test.tsx"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/sheets-sync.test.ts"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run block/warn/hidden and choice-other validation flows."

## Task Waves
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]

## E2E / Visual Validation Spec
- provider: playwright-cli
- artifact_root: `.playwright-cli/pattern-other-validation-output/`
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev`
- readiness_check: "Web app responds on port 3000 and API responds on port 3001."
- flows:
  - Configure short-text pattern as block, warn, hidden.
  - Submit mismatch for each mode.
  - Configure choice other validation and submit valid/invalid other text.
  - Verify response detail and export indicators.
- viewports:
  - desktop: 1440x900
  - mobile: 390x844
- evidence_requirements:
  - Screenshots for warning, hidden submit, admin match status, and other validation error.
  - Console/network errors summarized.
- known_flakiness:
  - Use deterministic regex fixtures.

## Rollback / Safety
- Keep legacy `allowPatternMismatch` parsing.
- Add metadata in a backward-compatible response shape.

## Progress Log
- 2026-07-06 Draft created. Validation not run; planning only.
- 2026-07-06 Draft updated.
  - Summary: Added security finding #14 safe-regex/ReDoS constraint.
  - Validation evidence: Not run; planning only.
  - Notes: Detailed remediation tracking lives in `security-findings-remediation-plan.md`.
- 2026-07-08 Work started.
  - Summary: Dispatched PATTERN-1 worker for shared pattern mismatch modes, choice other validation contract, and export metadata types.
  - Validation evidence: Pending worker validation.
  - Notes: Worker pending worktree `local:286640af-0ee5-4a73-8683-5e733178d870`, branch `codex/pattern-validation-contract`.

## Decision Log
- 2026-07-06 Decision:
  - Trigger / new insight: Issues 5 and 6 share validation contracts and output metadata.
  - Plan delta: Split into a dedicated validation/output plan.
  - Tradeoffs considered: Implementing only frontend warnings would not satisfy CSV/Sheets/admin visibility.
  - User approval: no

## Notes
- Risk: export column shape needs a product decision before implementation finalizes Task_3.
