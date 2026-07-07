# Plan: Validation Result Export

- status: draft
- generated: 2026-07-06
- last_updated: 2026-07-06
- work_type: code

## Goal
- Let validation plugins return any number of named output values per validation kind, let form owners choose which values are exported, and include selected validation result values in CSV and Google Sheets output.

## Definition of Done
- Plugin/result contracts are audited and extended if they do not already support arbitrary named output values.
- Built-in validation providers remain backwards-compatible with the result contract.
- Form validation/export settings allow owners to toggle output per provider/kind/value.
- CSV export and Google Sheets sync output selected latest validation result values through the shared response output model.
- Required targeted tests, UI/E2E evidence, reviewer approval, and repository validation pass.

## Scope / Non-goals
- Scope:
  - `packages/shared/src/**`
  - `packages/integrations/src/**`
  - `packages/validation-provider-discord/src/**`
  - `packages/validation-provider-github/src/**`
  - `packages/validation-provider-twitter/src/**`
  - `packages/database/src/**`
  - `apps/api/src/lib/forms/**`
  - `apps/api/src/routes/forms-*.ts`
  - `apps/api/src/routes/forms-responses*.ts`
  - `apps/api/src/__tests__/**`
  - `apps/worker/src/handlers/generic-validation.ts`
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/worker/src/handlers/__tests__/**`
  - `apps/web/src/components/editor/**`
  - `apps/web/src/components/forms/**`
  - `apps/web/src/**/*.test.tsx`
- Non-goals:
  - No response deletion implementation; that is covered by `response-deletion-plan.md`.
  - No historical revalidation implementation; that is covered by `historical-response-revalidation-plan.md`.
  - No Google OAuth scope changes unless implementation proves they are required.
  - No performance tests.

## Context (workspace)
- Related files/areas:
  - CSV and Sheets output were unified in `docs/coding-agent/plans/completed/response-export-sheets-unification-plan.md`.
  - Current Sheets full/incremental work is tracked in `docs/coding-agent/plans/active/google-sheets-sync-modes-plan.md`.
  - Validation output/admin visibility overlaps `docs/coding-agent/plans/active/pattern-other-validation-output-plan.md`.
  - Historical reruns that create latest validation results are covered by `docs/coding-agent/plans/active/historical-response-revalidation-plan.md`.
- Existing patterns or references:
  - CSV and Sheets should continue to use one shared response output contract.
  - Plugin payloads must be runtime-validated with zod before persistence/use.
  - Formula-like values must be neutralized for CSV/Sheets output.
- Repo reference docs consulted:
  - `AGENTS.md` supplied instructions.
  - `$orchestration-harness`
  - `$plan-format`
  - Existing plans listed above.
- Repo rules:
  - `docs/coding-agent/rules/**` is absent in this worktree. Waiver: use AGENTS/CLAUDE instructions and harness skills directly for validation policy.

## Open Questions (max 3)
- Q1: Should validation export columns use plugin-defined labels, stable output keys, or both in a two-row Sheets header model?
- Q2: Should failed/pending validation states export blank, status text, or separate status columns?
- Q3: Should array/object plugin output values be rejected, JSON-stringified, or require plugin authors to flatten them into scalar values?

## Assumptions
- A1: Plugin output values should be JSON-compatible scalars or null unless Task_1 explicitly chooses a broader contract.
- A2: Export uses latest completed validation results by default; pending/failed status output needs an explicit product decision.
- A3: Unknown historical output keys should remain displayable/export-configurable when present in saved results.
- A4: Response deletion and historical revalidation can land independently; this plan should defensively handle deleted responses and missing latest results.

## Tasks

### Task_1: Audit plugin result and export contracts
- type: research
- owns:
  - `docs/coding-agent/plans/active/validation-result-export-plan.md`
- depends_on: []
- description: |
  Inspect provider/plugin result schemas, worker persistence, API result reads, export settings storage, CSV output model, and Sheets sync. Determine whether arbitrary named values are already supported or require contract extension.
- acceptance:
  - Current plugin result capability is documented as sufficient or insufficient.
  - Output value key/label/value schema decision is recorded.
  - Export settings storage location is identified.
  - Required migration vs JSON-only change is identified before implementation.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "Plan updated with plugin output contract audit and export settings storage decision."

### Task_2: Extend plugin validation output values
- type: impl
- owns:
  - `packages/shared/src/**`
  - `packages/integrations/src/**`
  - `packages/validation-provider-discord/src/**`
  - `packages/validation-provider-github/src/**`
  - `packages/validation-provider-twitter/src/**`
  - `packages/database/src/**`
  - `apps/api/src/lib/forms/**`
  - `apps/worker/src/handlers/generic-validation.ts`
  - related tests
- depends_on: [Task_1]
- description: |
  If Task_1 finds the existing contract insufficient, extend provider/plugin result schemas so each validation kind can return arbitrary named output values with stable keys and optional labels.
- acceptance:
  - Shared zod schemas validate output value keys, labels, scalar values, and export metadata.
  - Built-in providers compile against the new contract and return backwards-compatible results.
  - Worker persists plugin output values without trusting malformed plugin payloads.
  - Existing validation result consumers continue to handle old results.
  - Tests cover malformed output values, multiple values per validation kind, and legacy result compatibility.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/shared test"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/integrations test"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review plugin API compatibility, runtime validation, and unsafe value handling."

### Task_3: Add validation output export settings API and UI
- type: impl
- owns:
  - `packages/shared/src/**`
  - `apps/api/src/routes/forms-*.ts`
  - `apps/api/src/lib/forms/**`
  - `apps/api/src/__tests__/**`
  - `apps/web/src/components/editor/**`
  - `apps/web/src/components/forms/**`
  - `apps/web/src/routes/**`
  - `apps/web/src/**/*.test.tsx`
- depends_on: [Task_2]
- description: |
  Add form settings that let owners choose which plugin output values are included in exports.
- acceptance:
  - Settings schema stores per provider/kind/output-key export toggles with safe defaults.
  - API save/load uses zod-validated request and response schemas.
  - UI renders discovered/built-in output keys with labels and stable fallback names.
  - Unknown historical output keys can still be displayed/configured when present in results.
  - Tests cover defaults, toggling values, unknown keys, and API validation errors.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "cd apps/api && pnpm exec vitest run src/__tests__/*forms*.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/editor src/components/forms"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run validation export settings UI flow using the E2E spec below."
  - kind: review
    required: true
    owner: reviewer
    detail: "Review settings persistence, accessibility, and no text overlap."

### Task_4: Export selected validation results to CSV and Sheets
- type: impl
- owns:
  - `packages/shared/src/response-export.ts`
  - `apps/api/src/lib/forms/response-export.ts`
  - `apps/api/src/routes/forms-responses*.ts`
  - `apps/api/src/__tests__/response-export.test.ts`
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/worker/src/handlers/__tests__/sheets-sync.test.ts`
  - `apps/web/src/components/forms/response-export*.tsx`
  - related tests
- depends_on: [Task_3]
- description: |
  Include selected validation result values in the shared export row model so CSV and Google Sheets remain consistent.
- acceptance:
  - CSV headers and Sheets headers are generated from the same validation output column model.
  - Exported validation values use latest completed validation results unless Task_1 chooses another policy.
  - Disabled output keys are omitted from CSV and Sheets.
  - Missing results, failed validations, deleted responses, duplicate labels, and formula-like values are handled safely.
  - Sheets sync updates/expands headers idempotently without duplicating historical rows.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/response-export.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/sheets-sync.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review CSV/Sheets parity, header migration, and formula injection safety."

### Task_5: Full validation and review
- type: review
- owns: []
- depends_on: [Task_4]
- description: |
  Run repository-required validation and independent review for the validation-result export slice.
- acceptance:
  - Required repo commands pass or failures are documented with root cause and owner.
  - Reviewer approves the complete validation-result export change.
  - Browser evidence covers settings toggles, CSV export, and mocked Sheets sync output.
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
    detail: "Independent final review with attention to plugin compatibility, settings persistence, and export correctness."

## Task Waves (explicit parallel dispatch sets)

- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]
- Wave 4 (parallel): [Task_4]
- Wave 5 (parallel): [Task_5]

## E2E / Visual Validation Spec

- provider: playwright-cli
- artifact_root: `.playwright-cli/validation-result-export/`
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev`
- readiness_check: "Web app responds on port 3000 and API responds on port 3001."
- flows:
  - Open validation/export settings.
  - Toggle individual output values, save, reload, and verify state persists.
  - Download CSV and verify selected validation output columns are present and disabled columns are absent.
  - Run mocked Google Sheets sync and verify selected validation output headers/cells are generated.
- viewports:
  - desktop: 1440x900
  - mobile: 390x844
- evidence_requirements:
  - Screenshots for settings toggles, saved/reloaded state, CSV export affordance, and Sheets sync state.
  - Console and network errors summarized.
- known_flakiness:
  - Google Sheets calls should be mocked or fixture-backed.
  - Validation providers should use deterministic test plugins/fixtures.

## Rollback / Safety
- Keep plugin result parsing backwards-compatible with existing validation rows.
- Prefer additive export columns and idempotent Sheets header expansion.
- Reject or safely normalize malformed plugin output values before persistence/export.
- Formula-like values must remain neutralized for CSV/Sheets.

## Progress Log

- 2026-07-06 Draft created from split of `response-management-validation-export-plan.md`.
  - Summary: Isolated plugin output contract, export settings, and CSV/Sheets validation result output.
  - Validation evidence: Not run; planning only.
  - Notes: Repository rule suite is absent.
- 2026-07-06 VEXPORT-1 worker slice completed investigation/implementation.
  - Summary: Existing provider `metadata` could store arbitrary JSON, but there was no explicit plugin contract for arbitrary named export output values. Added additive `ValidationProviderResult.outputValues` with key/label/scalar value validation, stored normalized values under the existing validation result `metadata` JSON reserved key, and exposed parsed `output_values` from validation result reads.
  - Validation evidence: Worker thread will report targeted/full command results in PR handoff.
  - Notes: No database migration is required for this slice because storage uses existing nullable JSON metadata. Follow-up tasks still need export settings UI/API and CSV/Sheets rendering decisions.
- 2026-07-07 VEXPORT-2 worker slice completed investigation/implementation for Task_3 only.
  - Summary: Added zod-backed `settings.validation_output_export` storage for per-rule/per-output-key toggles, API load/save endpoints under form structure routes, and a form settings UI section for independent validation output value toggles. Missing explicit settings continue to default each discovered value to enabled.
  - Investigation notes: VEXPORT-1 output values are available from validation result metadata as `output_values`; built-in rule output keys are discoverable before results exist, and saved/result-only unknown keys remain configurable with fallback labels. Storage stays in the existing form structure JSON settings object, so no database migration is required.
  - Rejected stopgaps: Did not add a new settings table or modify CSV/Google Sheets rendering, because export rendering belongs to Task_4/VEXPORT-3. Did not change worker validation execution or provider contracts beyond consuming the existing VEXPORT-1 output value contract.
  - Validation evidence: Focused API/web tests, full repo validation, UI evidence, independent review, and review-hook results are reported in the VEXPORT-2 PR handoff. UI evidence for this settings slice was captured with the non-escalated in-app browser after a local Playwright package attempt failed with `Cannot find module '/Users/xpadev/IdeaProjects/nexus-form/node_modules/playwright'`; artifacts are under `/tmp/nexus-form-vexport2-evidence/`, including `validation-output-export-settings-desktop-focused-section.png`, `validation-output-export-settings-mobile-focused-section.png`, `validation-output-export-iab-initial.json`, `validation-output-export-iab-reloaded.json`, and `mutable-fixture-log.json`.

## Decision Log

- 2026-07-06 Decision:
  - Trigger / new insight: User requested splitting the umbrella response management/validation/export plan.
  - Plan delta: Created a dedicated validation-result export plan with plugin contract, settings UI/API, and CSV/Sheets output tasks.
  - Tradeoffs considered: Bundling with revalidation would couple output schema work to queue semantics and make rollback harder.
  - User approval: yes
- 2026-07-06 Decision:
  - Trigger / new insight: VEXPORT-1 audit found `metadata` is arbitrary but not a stable output contract; arbitrary exportable values need validated keys, labels, and scalar values.
  - Plan delta: Task_2 is implemented as an additive plugin result field, `outputValues`, persisted in existing result metadata and parsed back as `output_values`.
  - Tradeoffs considered: A new DB column would make the contract more explicit but would require migration sequencing; storing under existing metadata preserves rolling deploy/rollback safety for old workers/API readers and old DB rows.
  - User approval: delegated task scope

## Notes
- Risks:
  - Arbitrary plugin output values can destabilize exports unless keys, labels, and scalar values are validated.
  - Sheets header migration must not duplicate existing rows or break existing integrations.
  - Unknown output keys from historical plugin versions need a stable fallback display/export policy.
- Edge cases:
  - Duplicate output labels across providers or validation kinds.
  - Missing latest validation result.
  - Failed or pending validation result.
  - Formula-like output values in CSV/Sheets.
