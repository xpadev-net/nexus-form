# Plan: Security Findings Remediation

- status: in_progress
- generated: 2026-07-06
- last_updated: 2026-07-08
- work_type: code

## Goal
- Triage and remediate the 22 findings from `codex-security-findings-2026-07-05T17-52-07.258Z.csv`.
- Decide which findings require code changes, which need verification/closure, and which should be appended to existing feature plans.

## Definition of Done
- Every CSV finding has an explicit disposition: fix, verify/close, duplicate/covered, or intentionally deferred with rationale.
- Medium-severity findings are fixed or have a concrete remediation task before lower-risk cleanup is marked complete.
- Related existing active plans reference the relevant findings so implementation workers do not miss security constraints.
- Required targeted tests plus repo validation pass.

## Scope / Non-goals
- Scope:
  - Export/Sheets/Drive/API hardening paths named by the CSV.
  - Share-link autosave replay protections.
  - Public submit, SSE, completion-target, condition-evaluator, telemetry, upload, appearance-image, CI, and migration hardening.
  - Existing active plans that overlap specific findings.
- Non-goals:
  - No GitHub issue/PR creation unless explicitly requested.
  - No resolving findings in the Codex Cloud UI from this plan alone.
  - No performance tests that assert runtime duration.

## Context (workspace)
- Source CSV: `/Users/xpadev/Downloads/codex-security-findings-2026-07-05T17-52-07.258Z.csv`.
- Parsed rows: 22 total: 11 medium, 4 low, 7 informational.
- Existing active plans already overlap several findings:
  - `google-sheets-sync-modes-plan.md`: Sheets sync/backfill/OAuth/progress work.
  - `plate-review-experience-plan.md`: viewer share-link/editor viewing behavior.
  - `pattern-other-validation-output-plan.md`: regex/pattern validation behavior.
  - `submit-completion-appearance-plan.md`: completion targets and public appearance.
  - `prefill-reachability-validation-plan.md`: condition evaluator/reachability parity.
- Repo rule suite is absent: `docs/coding-agent/rules` does not exist.

## Findings Triage

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | medium | Unbounded grid label expansion can DoS exports | Fix in Task_1; also referenced by Sheets/export work. |
| 2 | medium | Public submissions can rewrite Google Sheet headers | Fix in Task_1; trust snapshot titles, not submitted titles. |
| 3 | medium | Unbounded Google Drive folder metadata fan-out | Fix in Task_2. |
| 4 | medium | Read-only share edits can be replayed later as authorized saves | Fix in Task_3; also append to Plate review plan. |
| 5 | medium | Expensive uniqueness scoring can exhaust API/worker CPU | Fix in Task_1. |
| 6 | medium | API can start without required security migrations | Fix in Task_7. |
| 7 | medium | Completion target API validation enables editor CPU DoS | Fix in Task_4; also append to submit completion plan. |
| 8 | medium | SVG uploads enabled without validation | Fix in Task_5. |
| 9 | medium | OAuth refresh rate limits can drop Sheets sync jobs | Fix in Task_1; also append to Sheets plan. |
| 10 | medium | Workflow dispatch input is interpolated into shell command | Fix in Task_7. |
| 11 | medium | SSE preflight can miss client aborts and leak connections | Fix in Task_4. |
| 12 | low | Fragmented Sheets backfill can outlive sync lock | Fix in Task_1; also append to Sheets plan. |
| 13 | low | Telemetry candidate tokens are not fully burned | Verify/fix in Task_6; may already be addressed by prior telemetry work. |
| 14 | low | Blur validation triggers unsafe regex ReDoS | Fix in Task_4; also append to pattern validation plan. |
| 15 | low | Public form appearance permits tracking image URLs | Fix or explicit policy decision in Task_5; also append to appearance plan. |
| 16 | informational | Stale pre-lock idempotency value in Sheets sync | Verify/fix in Task_1. |
| 17 | informational | Dual telemetry tokens can break public form submits | Verify/fix in Task_6; likely duplicate with telemetry fixes. |
| 18 | informational | Dual telemetry tokens can break public submissions | Verify/fix in Task_6; likely duplicate with #17. |
| 19 | informational | Malformed section validation causes 500 on content save | Fix in Task_4. |
| 20 | informational | Includes rules match missing values on unanswered questions | Fix in Task_4; also append to prefill reachability plan. |
| 21 | informational | CI E2E harness only lists tests | Fix in Task_7. |
| 22 | informational | Changing applied migration timestamp can rerun 0012 | Verify/fix in Task_7. |

## Open Questions (max 3)
- Q1: For public appearance image URLs, should the product block all external images, proxy/cache them, or keep them with explicit tracking-risk warnings?
- Q2: Should low/informational telemetry findings be closed as duplicates after regression tests pass, or should each get its own small code change?
- Q3: Should Google Drive folder metadata traversal be lazy-loaded from the UI instead of returning a full tree in one API response?

## Assumptions
- A1: Medium findings require code remediation unless inspection proves they are false positives.
- A2: Public-submission trust boundaries must prefer published snapshot data over respondent payload fields.
- A3: Verification-only findings still need tests/evidence before being marked closed.

## Tasks

### Task_1: Harden response export, Sheets sync, and uniqueness work
- type: impl
- owns:
  - `packages/shared/src/response-choice-labels.ts`
  - `packages/shared/src/response-export.ts`
  - `packages/shared/src/forms/form-block.ts`
  - `packages/shared/src/response-data.ts`
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/routes/forms-responses.ts`
  - `apps/api/src/lib/forms/response-export.ts`
  - `apps/api/src/lib/forms/uniqueness-calculator.ts`
  - `apps/api/src/__tests__/response-export.test.ts`
  - `apps/api/src/__tests__/forms-public-validation-outbox.test.ts`
  - `apps/api/src/__tests__/response-analytics.test.ts`
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/worker/src/handlers/__tests__/sheets-sync.test.ts`
  - `apps/worker/src/lib/oauth-token-store.ts`
  - `apps/worker/src/lib/redis-lock.ts`
- depends_on: []
- description: |
  Address findings #1, #2, #5, #9, #12, and #16 by bounding grid expansion, ignoring untrusted submitted titles for output headers, bounding uniqueness work, preserving sync jobs across OAuth refresh rate limits, and keeping Sheets lock/idempotency behavior coherent.
- acceptance:
  - Grid label formatting does not expand every configured row for every response without a cap.
  - Sheets/CSV header titles come from trusted snapshot/extracted questions, not public submission `question_title`.
  - Export and Sheets paths have explicit row/label/uniqueness limits or batching.
  - OAuth refresh throttling does not silently drop sync jobs.
  - Sheets backfill cannot continue outside its intended lock boundary.
  - Stale pre-lock idempotency behavior is either fixed or documented as harmless with a regression test.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/response-export.test.ts src/__tests__/forms-public-validation-outbox.test.ts src/__tests__/response-analytics.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/sheets-sync.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Security review for export amplification, untrusted public payload fields, OAuth retry/drop behavior, and lock scope."

### Task_2: Bound Google Drive folder metadata traversal
- type: impl
- owns:
  - `apps/api/src/routes/integrations-google.ts`
  - `apps/api/src/types/domain/integrations-google.ts`
  - `apps/api/src/__tests__/integrations-google-spreadsheets.test.ts`
  - `apps/web/src/components/forms/google-sheets-integration/**`
- depends_on: []
- description: |
  Address finding #3 by bounding page size, folder depth, fan-out concurrency, timeouts, and/or moving folder traversal to lazy loading.
- acceptance:
  - API clamps `pageSize` to a local maximum.
  - Folder metadata fetching has bounded concurrency and depth.
  - API handles Google timeout/rate-limit responses without unbounded waits.
  - UI still disambiguates folders/spreadsheets enough for selection.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/integrations-google-spreadsheets.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/google-sheets-integration/spreadsheet-selector.test.tsx src/components/forms/google-sheets-integration/use-google-sheets-integration-model.test.tsx"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review outbound request amplification and Drive quota behavior."

### Task_3: Prevent share-link pending-save replay
- type: impl
- owns:
  - `apps/web/src/components/forms/form-editor-page.tsx`
  - `apps/web/src/hooks/forms/use-form-content-autosave.ts`
  - `apps/web/src/components/forms/form-editor-page.test.tsx`
  - `apps/api/src/routes/forms-content.ts`
  - `apps/api/src/lib/dual-auth.ts`
  - `apps/api/src/__tests__/authz-regression.test.ts`
- depends_on: []
- description: |
  Address finding #4 by binding pending local saves to the principal/role that created them and preventing VIEWER-authored pending edits from replaying under later editor credentials.
- acceptance:
  - VIEWER share-link sessions cannot create retriable pending saves that later replay as owner/editor saves.
  - Pending-save records include form id, auth/principal scope, role, and failure reason or are cleared on 401/403.
  - Mount retry refuses mismatched principal/role pending saves.
  - Server-side authorization remains the final gate.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-editor-page.test.tsx src/hooks/forms/use-form-content-autosave.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/authz-regression.test.ts"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run share-link VIEWER edit/reload/re-auth replay scenario."

### Task_4: Harden public/API validation and realtime routes
- type: impl
- owns:
  - `apps/api/src/routes/forms-content.ts`
  - `apps/api/src/routes/forms-detail.ts`
  - `apps/api/src/routes/forms-sse.ts`
  - `apps/api/src/lib/forms/completion-target-validation.ts`
  - `apps/api/src/lib/forms/response-validator.ts`
  - `apps/api/src/__tests__/forms-completion-target-validation.test.ts`
  - `apps/api/src/__tests__/forms-sse-*.test.ts`
  - `apps/api/src/__tests__/response-validator.test.ts`
  - `packages/shared/src/plate-content-utils.ts`
  - `packages/shared/src/forms/condition-evaluator.ts`
  - `packages/shared/src/__tests__/plate-content-utils.test.ts`
  - `apps/web/src/utils/validation/question-validators.ts`
  - `apps/web/src/components/forms/form-body.tsx`
  - `apps/web/src/components/ui/form-question-nodes/form-short-text-node.tsx`
- depends_on: []
- description: |
  Address findings #7, #11, #14, #19, and #20 by bounding completion-target validation, handling SSE aborts before allocation, using safe regex on blur/client validation, returning 400 instead of 500 for malformed section validation, and fixing includes rules on missing values.
- acceptance:
  - Completion-target validation is bounded by node count/depth/action count and fails with controlled 400 responses.
  - SSE preflight observes already-aborted requests and does not leak subscribers.
  - Client blur validation cannot run unsafe regex patterns.
  - Malformed section validation on content save returns a validation error, not 500.
  - `includes_any` / `includes_all` do not match unanswered/missing values unintentionally.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-completion-target-validation.test.ts src/__tests__/response-validator.test.ts src/__tests__/forms-sse-keepalive.test.ts src/__tests__/forms-sse-subscribers.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/shared exec vitest run src/__tests__/plate-content-utils.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/utils/validation/question-validators.test.ts src/components/forms/form-body.test.tsx"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review bounded validation, regex safety, SSE cleanup, and branching semantics."

### Task_5: Harden uploads and public appearance media
- type: impl
- owns:
  - `env.example`
  - `apps/api/src/config/image-processing.ts`
  - `apps/api/src/lib/s3/validation.ts`
  - `apps/api/src/lib/s3/utils.ts`
  - `apps/api/src/routes/s3.ts`
  - `packages/shared/src/validation/appearance.ts`
  - `apps/api/src/lib/forms/public-structure.ts`
  - `apps/web/src/components/forms/form-body.tsx`
  - `apps/web/src/components/forms/public-form-page.tsx`
  - related tests under `apps/api/src/__tests__` and `packages/shared/src/__tests__`
- depends_on: []
- description: |
  Address findings #8 and #15 by validating/disabling SVG uploads and deciding how public appearance image URLs avoid tracking risks.
- acceptance:
  - SVG uploads are rejected or sanitized with explicit allowlist behavior.
  - MIME type, extension, and content checks cannot be bypassed by simple spoofing.
  - Public appearance image URLs are proxied, restricted, or warned according to a documented decision.
  - Unsafe legacy public appearance image URLs remain sanitized.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/s3-ownership.test.ts src/__tests__/image-service-sharp.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/shared test"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review SVG/content sniffing and public tracking-image risk decision."

### Task_6: Verify and close telemetry findings
- type: impl
- owns:
  - `apps/api/src/lib/telemetry/tokens.ts`
  - `apps/api/src/routes/telemetry.ts`
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/__tests__/authz-regression.test.ts`
  - `apps/web/src/lib/telemetry-token.ts`
  - `apps/web/src/components/forms/public-form-page.tsx`
  - `apps/web/src/components/forms/public-form-page.test.tsx`
  - `docs/coding-agent/lessons.md`
- depends_on: []
- description: |
  Address findings #13, #17, and #18 by verifying the prior telemetry fixes, adding regression coverage if missing, and applying any remaining burn/dual-token fixes.
- acceptance:
  - At least one valid v4/v6 token can authorize submit.
  - All submitted unused/unexpired candidate tokens are burned after authorization as intended.
  - Non-matching/expired/used tokens do not create false failures or replay windows.
  - Duplicate findings are documented as verified duplicates if no code change remains.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/authz-regression.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/public-form-page.test.tsx"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review token authorization vs candidate burn semantics against lessons.md."

### Task_7: Harden CI, release workflow, startup migrations, and migration journal
- type: impl
- owns:
  - `package.json`
  - `.github/workflows/ci.yml`
  - `.github/workflows/release.yml`
  - `docker/start.mjs`
  - `start.sh`
  - `k8s/base/api-migration-job.yaml`
  - `packages/database/drizzle/meta/_journal.json`
  - `packages/database/drizzle/0012_config_json_column_type.sql`
  - `packages/database/drizzle/0013_active_snapshot_structure_live_security_compat.sql`
  - `packages/database/src/migrate.ts`
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/__tests__/database-migration-journal.test.ts`
  - `apps/api/src/__tests__/database-snapshot-structure-migration.test.ts`
- depends_on: []
- description: |
  Address findings #6, #10, #21, and #22 by failing startup when required migrations are missing, removing shell interpolation from release dispatch inputs, running actual E2E checks in CI, and stabilizing migration metadata.
- acceptance:
  - API startup/deploy path cannot skip required security migrations silently.
  - Release workflow treats user-provided dispatch input as data, not shell syntax.
  - CI E2E command executes tests rather than only listing them.
  - Migration journal/timestamp changes cannot rerun `0012` unexpectedly.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/database-migration-journal.test.ts src/__tests__/database-snapshot-structure-migration.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm type-check"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review workflow command construction, migration fail-closed behavior, and CI E2E command correctness."

### Task_8: Final security finding closure review
- type: review
- owns: []
- depends_on: [Task_1, Task_2, Task_3, Task_4, Task_5, Task_6, Task_7]
- description: |
  Run repo-wide validation, map each finding to evidence, and prepare closure notes.
- acceptance:
  - Every finding in the CSV has pass/fix/duplicate/false-positive evidence.
  - Reviewer status is APPROVED.
  - Required repo validation passes or failures are documented with root cause and owner.
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
    detail: "Independent security review against all 22 CSV findings."

## Task Waves
- Wave 1 (parallel): [Task_1, Task_2, Task_3, Task_4, Task_5, Task_6, Task_7]
- Wave 2 (parallel): [Task_8]

## E2E / Visual Validation Spec
- provider: playwright-cli
- artifact_root: `.playwright-cli/security-findings-remediation/`
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev`
- readiness_check: "Web app responds on port 3000 and API responds on port 3001."
- flows:
  - Share-link VIEWER pending-save replay attempt.
  - Public form telemetry dual-token submit regression.
  - Public form appearance image handling for allowed/disallowed cases.
  - Sheets sync retry/backfill lock behavior with mocked OAuth refresh throttling.
- viewports:
  - desktop: 1440x900
- evidence_requirements:
  - Network evidence for rejected unauthorized/replay/crafted requests.
  - Console/network errors summarized.
  - Screenshots only where UI state is relevant.
- known_flakiness:
  - Use mocked external Google/OAuth/S3 calls for deterministic checks.

## Rollback / Safety
- Prioritize fail-closed behavior for public submission, upload, and auth replay fixes.
- Keep backwards-compatible parsing where possible, but do not preserve insecure trust in public payload fields.
- Split implementation PRs by task group to reduce regression risk.

## Progress Log
- 2026-07-06 Draft created.
  - Summary: Triaged 22 CSV findings and grouped them into eight remediation tasks.
  - Validation evidence: CSV parsed locally; code validation not run.
  - Notes: Existing active plans were updated with overlapping finding references.
- 2026-07-08 Work continued.
  - Summary: Dispatched SEC-6 worker for telemetry finding verification/regression coverage while other active security-overlap work remains in separate feature plans.
  - Validation evidence: Pending worker validation.
  - Notes: Worker pending worktree `local:a80d72c2-5f3b-49c8-aa1f-0f0bf541bc27`, branch `codex/sec-telemetry-token-regressions`.
- 2026-07-08 Completed security slices.
  - Summary: SEC-2, SEC-3, and SEC-6 have landed for Drive traversal bounds, share-link pending-save replay prevention, and telemetry token regressions.
  - Validation evidence: Parent merge gates for PR #617, PR #616, and PR #632 passed focused tests, repo validation, review hooks, and independent review.
  - Notes: Remaining security plan tasks are Task_1, Task_4, Task_5, Task_7, and final Task_8 closure review. Some Task_4 constraints overlap active prefill/pattern/submit work.
- 2026-07-08 Work continued.
  - Summary: Preparing SEC-7 worker for CI/release/startup migration/migration-journal hardening.
  - Validation evidence: Pending worker validation.
  - Notes: Worker must create an explicit Codex goal before implementation.

## Decision Log
- 2026-07-06 Decision:
  - Trigger / new insight: Security findings span multiple prior feature plans and several unrelated infra/API areas.
  - Plan delta: Create a dedicated security remediation plan and append specific overlap notes to existing plans instead of scattering all 22 findings across feature plans.
  - Tradeoffs considered: Creating 22 separate plans would be precise but noisy; grouping by ownership/path keeps remediation reviewable while retaining per-finding disposition.
  - User approval: no

## Notes
- Risks:
  - Some findings may already be fixed in prior untracked/completed work; still require explicit regression evidence before closure.
  - Several findings share paths with active feature plans, so implementation ordering should avoid duplicate edits.
