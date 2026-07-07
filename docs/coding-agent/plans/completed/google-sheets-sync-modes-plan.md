# Plan: Google Sheets Sync Modes And Progress

- status: completed
- generated: 2026-07-06
- last_updated: 2026-07-06
- work_type: code

## Goal
- Fix issues 1 and 2: expose both incremental sync and explicit full historical sync for Google Sheets, and make the UI completion state stop showing stale 40% progress after completion.

## Definition of Done
- Sheets UI has separate incremental and full sync actions.
- API and worker receive a validated sync mode instead of relying on ambiguous `force` semantics.
- Full sync processes historical responses idempotently.
- Completed jobs display 100% or an equivalent completed state regardless of stale BullMQ progress payloads.
- Required targeted tests plus repo validation pass.

## Scope / Non-goals
- Scope:
  - `apps/api/src/routes/forms-integrations*.ts`
  - `apps/api/src/lib/forms/form-integration-service.ts`
  - `apps/api/src/__tests__/forms-integrations-google-sheets-sync-auth.test.ts`
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/worker/src/handlers/__tests__/sheets-sync.test.ts`
  - `apps/web/src/components/forms/google-sheets-integration.tsx`
  - `apps/web/src/components/forms/google-sheets-integration/**`
  - `apps/web/src/types/integrations/google-sheets.ts`
- Non-goals:
  - No Google OAuth scope changes unless implementation proves they are required.
  - No export column redesign; response export/sheets unification is already covered by the completed prior plan.

## Context (workspace)
- `use-google-sheets-sync.ts` currently posts `{ force }`, starts with `force: true`, and falls back on `413`.
- The status hook maps BullMQ `completed` to UI completed but preserves raw progress, which can leave stale percentages visible.
- Prior completed plan `response-export-sheets-unification-plan.md` moved CSV/Sheets output toward shared export helpers.
- Security findings from `codex-security-findings-2026-07-05T17-52-07.258Z.csv` overlap this plan:
  - #1 unbounded grid label expansion can DoS exports.
  - #2 public submissions can rewrite Google Sheet headers.
  - #9 OAuth refresh rate limits can drop Sheets sync jobs.
  - #12 fragmented Sheets backfill can outlive sync lock.
  - #16 stale pre-lock idempotency value in Sheets sync.
- Repo rule suite is absent: `docs/coding-agent/rules` does not exist.

## Open Questions (max 3)
- Q1: Should full sync rewrite existing synced rows, append missing rows only, or offer a future overwrite option?
- Q2: Should the full sync confirmation show an estimated response count before enqueueing?

## Assumptions
- A1: Incremental sync remains the default action.
- A2: Full sync is idempotent by response id and must not duplicate rows.
- A3: Existing `force` callers are supported during migration for backward compatibility.

## Tasks

### Task_1: Define sync mode API contract
- type: impl
- owns:
  - `apps/api/src/routes/forms-integrations*.ts`
  - `apps/api/src/__tests__/forms-integrations-google-sheets-sync-auth.test.ts`
  - `apps/web/src/types/integrations/google-sheets.ts`
- depends_on: []
- description: |
  Add a zod-validated sync mode contract, preserving legacy `force` parsing while moving callers to `mode: "incremental" | "full"`.
- acceptance:
  - API accepts and validates explicit sync mode.
  - Legacy `force` maps to the intended mode.
  - Unauthorized/cross-tenant sync status behavior is unchanged.
  - Tests cover mode parsing and job payload.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-integrations-google-sheets-sync-auth.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review API contract compatibility and tenant isolation."

### Task_2: Implement worker full vs incremental selection
- type: impl
- owns:
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/worker/src/handlers/__tests__/sheets-sync.test.ts`
- depends_on: [Task_1]
- description: |
  Select historical or incremental response sets based on sync mode while preserving row idempotency and locking.
- acceptance:
  - Full mode considers all eligible historical responses.
  - Incremental mode keeps current bounded behavior.
  - Existing sheet rows are not duplicated.
  - Progress reports processed/total where possible.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/sheets-sync.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review idempotency, locking, and large-response behavior."

### Task_3: Add UI actions and progress completion fix
- type: impl
- owns:
  - `apps/web/src/components/forms/google-sheets-integration.tsx`
  - `apps/web/src/components/forms/google-sheets-integration/**`
- depends_on: [Task_1]
- description: |
  Add separate buttons for incremental/full sync and normalize terminal progress display.
- acceptance:
  - Full sync requires explicit confirmation.
  - Incremental sync remains quick/default.
  - Completed state renders 100% or hides stale progress.
  - Stale final 40% state has a regression test.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/google-sheets-integration/use-google-sheets-sync.test.tsx src/components/forms/google-sheets-integration/use-google-sheets-integration-model.test.tsx"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run mocked Sheets sync UI flow for incremental, full confirmation, and stale 40% completion."

## Task Waves
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2, Task_3]

## E2E / Visual Validation Spec
- provider: playwright-cli
- artifact_root: `.playwright-cli/google-sheets-sync-modes/`
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev`
- readiness_check: "Web app responds on port 3000 and API responds on port 3001."
- flows:
  - Open Google Sheets integration settings.
  - Run incremental sync through queued, processing, completed.
  - Run full sync, confirm prompt, verify queued state.
  - Mock completed job with stale 40% progress and verify UI displays completed/100%.
- viewports:
  - desktop: 1440x900
  - mobile: 390x844
- evidence_requirements:
  - Screenshots of action buttons, confirmation dialog, processing state, completed state.
  - Console and network errors summarized.
- known_flakiness:
  - Google calls should be mocked or fixture-backed.

## Rollback / Safety
- Preserve legacy `force` parsing until all clients are migrated.
- Full sync remains idempotent by response id.
- Do not trust public submission `question_title` for Sheets header/title updates; use snapshot-derived titles.
- Keep backfill work inside the intended lock scope and preserve jobs across OAuth retry/rate-limit paths.

## Progress Log
- 2026-07-06 Draft created. Validation not run; planning only.
- 2026-07-06 Draft updated.
  - Summary: Added overlapping security findings #1, #2, #9, #12, and #16 as implementation constraints.
  - Validation evidence: Not run; planning only.
  - Notes: Detailed remediation tracking lives in `security-findings-remediation-plan.md`.

## Decision Log
- 2026-07-06 Decision:
  - Trigger / new insight: Sync issues are cohesive and independent of Plate/comment work.
  - Plan delta: Split into a dedicated Sheets plan instead of a larger omnibus plan.
  - Tradeoffs considered: Keeping full sync as `force` is smaller but ambiguous; explicit mode is safer.
  - User approval: no
- 2026-07-06 Decision:
  - Trigger / new insight: Security CSV findings identified Sheets/export-specific amplification, trust, OAuth retry, lock, and idempotency risks.
  - Plan delta: Add the findings as constraints while keeping detailed fix grouping in the dedicated security remediation plan.
  - Tradeoffs considered: Folding all security tasks into this plan would obscure the original sync-mode work.
  - User approval: no

## Notes
- Risk: full sync can be expensive; batching and duplicate prevention need focused review.
