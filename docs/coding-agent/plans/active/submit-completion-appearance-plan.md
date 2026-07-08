# Plan: Submit Completion And Editor Appearance

- status: in_progress
- generated: 2026-07-06
- last_updated: 2026-07-08
- work_type: code

## Goal
- Fix issues 3, 4, and 11: integrate the default submit completion page into Plate-managed content, apply appearance settings to the full edit page, and rename submit-transition actions so they describe the actual post-submit section transition.

## Definition of Done
- Forms without explicit completion targets render a default Plate completion page after submission.
- Explicit post-submit sections do not compete with a legacy success paragraph.
- Editor action labels no longer describe post-submit navigation as generic "送信する"; they explain that the form transitions to a post-submit section/page.
- Saved appearance applies to editor shell, tabs, settings, validation, sharing, and responses.
- Required targeted tests plus repo validation pass.

## Scope / Non-goals
- Scope:
  - `packages/shared/src/plate-content-utils.ts`
  - `apps/api/src/lib/forms/form-structure-validator.ts`
  - `apps/api/src/lib/forms/public-structure.ts`
  - `apps/api/src/routes/forms-structure.ts`
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/__tests__/forms-completion-target-validation.test.ts`
  - `apps/api/src/__tests__/forms-structure-post-submit-route.test.ts`
  - `apps/web/src/components/forms/form-body.tsx`
  - `apps/web/src/components/forms/public-form-page.tsx`
  - `apps/web/src/components/forms/form-preview-page.tsx`
  - `apps/web/src/components/forms/logic-action-builder.tsx`
  - `apps/web/src/components/ui/form-question-nodes/editor-controls.tsx`
  - `apps/web/src/components/forms/form-editor-page.tsx`
  - `apps/web/src/components/forms/form-editor-page/**`
  - `apps/web/src/components/forms/form-appearance-surface.tsx`
  - `apps/web/src/components/forms/form-appearance-settings.tsx`
- Non-goals:
  - No redesign of the post-submit notification settings.
  - No migration of existing custom completion pages beyond backward-compatible rendering.

## Context (workspace)
- `FormBody` currently renders Plate content and a separate `success` paragraph.
- API already validates completion targets and prevents answerable questions in completion pages.
- `logic-action-builder.tsx` currently labels the `submit` action as "送信する", but in this UI it means transitioning to a post-submit target rather than immediately submitting from the editor.
- `FormAppearanceSurface` resolves appearance CSS variables, but editor page sections currently use ordinary card/page styling.
- Security findings from `codex-security-findings-2026-07-05T17-52-07.258Z.csv` overlap this plan:
  - #7 completion target API validation enables editor CPU DoS.
  - #15 public form appearance permits tracking image URLs.
- Repo rule suite is absent: `docs/coding-agent/rules` does not exist.

## Open Questions (max 3)
- Q1: What default copy should the generated Plate completion page use?
- Q2: Should editor admin chrome use the form font family, or only content surfaces/tabs?
- Q3: Final Japanese label copy: "送信後セクションへ遷移", "送信完了ページへ遷移", or another product term?

## Assumptions
- A1: The default completion page should be stored/derived as Plate content, not as a separate string message.
- A2: Admin controls must remain readable even when the form appearance has poor contrast.

## Tasks

### Task_1: Add default Plate completion target behavior
- type: impl
- owns:
  - `packages/shared/src/plate-content-utils.ts`
  - `apps/api/src/lib/forms/form-structure-validator.ts`
  - `apps/api/src/lib/forms/public-structure.ts`
  - `apps/api/src/routes/forms-structure.ts`
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/__tests__/forms-completion-target-validation.test.ts`
  - `apps/api/src/__tests__/forms-structure-post-submit-route.test.ts`
- depends_on: []
- description: |
  Model the default completion view as a Plate completion page/section, preserving existing explicit completion target validation.
- acceptance:
- Missing completion target resolves to a default Plate page.
- Explicit completion target remains authoritative.
- Answerable questions inside completion target are rejected.
- Completion target validation is bounded by node count/depth/action count and returns controlled validation errors for malformed input.
- Public structure exposes only safe completion content.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-completion-target-validation.test.ts src/__tests__/forms-structure-post-submit-route.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review completion target compatibility and public structure sanitization."

### Task_2: Render completion through FormBody only once
- type: impl
- owns:
  - `apps/web/src/components/forms/form-body.tsx`
  - `apps/web/src/components/forms/public-form-page.tsx`
  - `apps/web/src/components/forms/form-preview-page.tsx`
  - `apps/web/src/components/forms/form-appearance-settings.tsx`
- depends_on: [Task_1]
- description: |
  Remove competing legacy success rendering when a completion page is shown, including preview behavior.
- acceptance:
  - Default completion renders as Plate content.
  - Explicit completion renders without legacy success paragraph.
  - Preview copy remains clear and non-submitting.
  - Multi-page submit navigation still works.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-body.test.tsx src/components/forms/public-form-page.test.tsx src/components/forms/form-preview-page.test.tsx src/components/forms/form-appearance-settings.test.tsx"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run public and preview submit completion flows."

### Task_3: Apply saved appearance to full editor page
- type: impl
- owns:
  - `apps/web/src/components/forms/form-editor-page.tsx`
  - `apps/web/src/components/forms/form-editor-page/**`
  - `apps/web/src/components/forms/form-appearance-surface.tsx`
  - `apps/web/src/components/forms/form-appearance-settings.tsx`
  - `apps/web/src/components/forms/form-editor-page.test.tsx`
  - `apps/web/src/components/forms/form-appearance-settings.test.tsx`
- depends_on: []
- description: |
  Load saved appearance at editor-page level and wrap editor/settings/sharing/validation/responses surfaces with appearance variables.
- acceptance:
  - Saved appearance updates editor page without a full reload after save.
  - Editor, settings, sharing, validation, and responses tabs inherit core CSS variables.
  - Draft appearance preview remains independent.
  - Admin controls remain legible under high/low contrast themes.
  - Public appearance image URL handling has an explicit tracking-risk mitigation or product decision.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-editor-page.test.tsx src/components/forms/form-appearance-settings.test.tsx"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run editor appearance visual checks on desktop and mobile."

### Task_4: Rename submit-transition action labels
- type: impl
- owns:
  - `apps/web/src/components/forms/logic-action-builder.tsx`
  - `apps/web/src/components/forms/logic-action-builder.test.tsx`
  - `apps/web/src/components/ui/form-question-nodes/editor-controls.tsx`
  - `apps/web/src/components/editor/plate-editor-internal.test.tsx`
- depends_on: []
- description: |
  Rename editor-facing `submit` action labels from "送信する" to wording that accurately describes navigating to a post-submit section/page.
- acceptance:
  - Action select labels use post-submit transition wording instead of "送信する".
  - Existing saved action payloads remain `{ type: "submit", target_id?: ... }`; only displayed copy changes.
  - Missing/deleted target copy stays understandable.
  - Tests assert the new visible label and unchanged payload.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/logic-action-builder.test.tsx src/components/editor/plate-editor-internal.test.tsx"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Verify post-submit action labels in the Plate editor controls."

## Task Waves
- Wave 1 (parallel): [Task_1, Task_3, Task_4]
- Wave 2 (parallel): [Task_2]

## E2E / Visual Validation Spec
- provider: playwright-cli
- artifact_root: `.playwright-cli/submit-completion-appearance/`
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev`
- readiness_check: "Web app responds on port 3000 and API responds on port 3001."
- flows:
  - Submit a public form without explicit completion target.
  - Submit a form with explicit completion target.
  - Open logic/action controls and verify the post-submit transition label is visible and understandable.
  - Save custom appearance and verify editor tabs inherit it.
- viewports:
  - desktop: 1440x900
  - mobile: 390x844
- evidence_requirements:
  - Screenshots of completion pages and themed editor tabs.
  - Console/network errors summarized.
- known_flakiness:
  - Use deterministic fixtures for public/preview form content.

## Rollback / Safety
- Keep fallback legacy success text until default Plate completion is verified.
- Apply appearance through scoped CSS variables to avoid leaking into global app chrome.

## Progress Log
- 2026-07-06 Draft created. Validation not run; planning only.
- 2026-07-06 Draft updated.
  - Summary: Added issue 11 as Task_4 to rename submit-transition UI copy.
  - Validation evidence: Not run; planning only.
  - Notes: Payload remains `type: "submit"` for compatibility.
- 2026-07-06 Draft updated.
  - Summary: Added security findings #7 and #15 as constraints for completion validation and public appearance media.
  - Validation evidence: Not run; planning only.
  - Notes: Detailed remediation tracking lives in `security-findings-remediation-plan.md`.
- 2026-07-08 Work started.
  - Summary: Preparing SUBMIT-4 worker for the narrow submit-transition label rename task.
  - Validation evidence: Pending worker validation.
  - Notes: Worker must create an explicit Codex goal before implementation.

## Decision Log
- 2026-07-06 Decision:
  - Trigger / new insight: Completion rendering and appearance are both `FormBody`/editor-surface concerns.
  - Plan delta: Split from Sheets and validation plans.
  - Tradeoffs considered: Appearance could be separate, but it shares visual E2E setup with completion rendering.
  - User approval: no
- 2026-07-06 Decision:
  - Trigger / new insight: User clarified the editor action label "送信する" is misleading because the action represents moving to a post-submit section/page.
  - Plan delta: Added a dedicated label-only UI task to this completion/appearance plan.
  - Tradeoffs considered: Renaming the underlying action type would be more invasive and unnecessary; keeping payload stable avoids API/snapshot migration.
  - User approval: no

## Notes
- Risk: applying arbitrary appearance to admin UI can reduce readability; reviewer visual checks are required.
