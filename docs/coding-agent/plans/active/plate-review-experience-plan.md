# Plan: Plate Review Experience Improvements

- status: draft
- generated: 2026-07-06
- last_updated: 2026-07-06
- work_type: code

## Goal
- Fix issues 7, 8, 9, and 10: confirm deletion of Plate input fields, improve diff readability and placement, render viewer share links through editor viewing mode, and add text comments for review.

## Definition of Done
- Deleting a Plate form question/input block shows a confirmation dialog.
- Diffs show human-readable labels and visual markers near the Plate UI instead of raw internal ids.
- Viewer share links use the editor in viewing mode, not the separate viewer kit path.
- Users can comment on selected Plate text for review, with persistence and permission behavior.
- Required targeted tests plus UI E2E pass.

## Scope / Non-goals
- Scope:
  - `packages/shared/src/plate-content-utils.ts`
  - `packages/shared/src/plate-merge.ts`
  - `apps/web/src/components/editor/**`
  - `apps/web/src/components/editor/plugins/comment-kit.tsx`
  - `apps/web/src/components/editor/plugins/form-questions/**`
  - `apps/web/src/components/forms/form-editor-page.tsx`
  - `apps/web/src/components/forms/plate-conflict-banner.tsx`
  - `apps/web/src/hooks/forms/use-plate-merge.ts`
  - `apps/web/src/components/forms/share-link-manager.tsx`
  - `apps/web/src/components/forms/form-sharing-section.tsx`
  - `apps/api/src/routes/forms-structure.ts`
  - `apps/api/src/lib/forms/form-structure-validator.ts`
  - related shared/api/web tests
- Non-goals:
  - No external review workflow or notification system.
  - No complete replacement of Plate editor internals.

## Context (workspace)
- `EditorKit` already includes `CommentKit` and `SuggestionKit`.
- `PlateViewer` uses `ViewerKit`; `PlateEditorInternal` can already run read-only with `ViewerKit`.
- Diff/conflict UI exists through `PlateConflictBanner`, `use-plate-merge`, and shared `plate-merge`.
- Form question normalization already protects invalid empty question nodes.
- Security finding #4 from `codex-security-findings-2026-07-05T17-52-07.258Z.csv` overlaps this plan: read-only share edits can be replayed later as authorized saves through pending localStorage autosave.
- Repo rule suite is absent: `docs/coding-agent/rules` does not exist.

## Open Questions (max 3)
- Q1: Should comments be visible to viewer share links, editor share links only, or owner/editor users only?
- Q2: Should resolved comments remain stored and hidden, or be removed from Plate content?
- Q3: Should diff markers appear only during conflict resolution or also for unpublished changes?

## Assumptions
- A1: Deletion confirmation should apply to form question/input blocks, not ordinary text blocks.
- A2: Internal ids can remain in a details/debug affordance but should not be the primary diff label.
- A3: Comment persistence can use sanitized Plate content unless implementation proves a sidecar store is required.

## Tasks

### Task_1: Confirm destructive Plate question deletion
- type: impl
- owns:
  - `apps/web/src/components/editor/plugins/form-questions/**`
  - `apps/web/src/components/editor/plate-editor-internal.tsx`
  - `apps/web/src/components/editor/plate-editor-internal.test.tsx`
  - `apps/web/src/components/ui/**`
- depends_on: []
- description: |
  Intercept keyboard, block menu, and structural deletion paths for form question nodes and require confirmation.
- acceptance:
  - Question deletion via keyboard and block controls opens a confirmation dialog.
  - Cancel preserves content.
  - Confirm deletes exactly the intended question.
  - Ordinary text deletion remains unchanged.
  - Dialog copy explains collected answers are not deleted.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/editor/plate-editor-internal.test.tsx"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run keyboard and block-control deletion flows."

### Task_2: Improve human-readable Plate diff UI
- type: impl
- owns:
  - `packages/shared/src/plate-merge.ts`
  - `packages/shared/src/__tests__/plate-merge.test.ts`
  - `apps/web/src/hooks/forms/use-plate-merge.ts`
  - `apps/web/src/components/forms/plate-conflict-banner.tsx`
  - `apps/web/src/components/forms/form-editor-page.tsx`
  - `apps/web/src/components/editor/**`
  - `apps/web/src/components/forms/plate-conflict-banner.test.tsx`
- depends_on: []
- description: |
  Convert diff/conflict output to readable labels and render added/removed/modified markers in a Plate-adjacent left rail.
- acceptance:
  - Diff items show question title, block type, field label, and before/after summary.
  - Raw internal ids are hidden by default.
  - Left rail markers distinguish added/removed/modified/conflict states.
  - Clicking a diff item scrolls/focuses the related block when present.
  - Removed blocks have a readable placeholder marker.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/shared exec vitest run src/__tests__/plate-merge.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/plate-conflict-banner.test.tsx src/hooks/forms/use-plate-merge.test.ts"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run conflict/diff visual checks."

### Task_3: Render viewer share links through editor viewing mode
- type: impl
- owns:
  - `apps/web/src/components/editor/plate-editor.tsx`
  - `apps/web/src/components/editor/plate-editor-internal.tsx`
  - `apps/web/src/components/editor/plate-viewer.tsx`
  - `apps/web/src/components/editor/plate-viewer-internal.tsx`
  - `apps/web/src/components/forms/share-link-manager.tsx`
  - `apps/web/src/components/forms/form-sharing-section.tsx`
  - `apps/web/src/components/forms/share-link-manager.test.tsx`
  - `apps/web/src/components/editor/plate-viewer.test.tsx`
- depends_on: []
- description: |
  Add a viewing mode path that uses the editor shell without edit permissions for viewer share links.
- acceptance:
  - Viewer share links render with editor viewing mode.
  - VIEWER share links cannot edit.
  - VIEWER share-link attempts cannot create pending local saves that later replay under owner/editor credentials.
  - Public respondent forms continue rendering answer inputs correctly.
  - Tests assert mode/plugin selection.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/editor/plate-viewer.test.tsx src/components/forms/share-link-manager.test.tsx"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run share-link viewer flow."

### Task_4: Add persisted Plate text comments for review
- type: impl
- owns:
  - `packages/shared/src/plate-content-utils.ts`
  - `packages/shared/src/__tests__/plate-content-utils.test.ts`
  - `apps/api/src/routes/forms-structure.ts`
  - `apps/api/src/lib/forms/form-structure-validator.ts`
  - `apps/api/src/__tests__/forms-detail-publish-route.test.ts`
  - `apps/web/src/components/editor/plugins/comment-kit.tsx`
  - `apps/web/src/components/editor/**`
  - `apps/web/src/components/forms/form-editor-page.tsx`
  - `apps/web/src/components/editor/plate-editor-internal.test.tsx`
- depends_on: [Task_3]
- description: |
  Wire Plate comments into a review workflow: select text, create/comment/resolve, save sanitized comment marks, and apply permissions.
- acceptance:
  - Users can add comments to selected text.
  - Comments persist after save/reload.
  - Permission behavior follows Q1 resolution.
  - Sanitization preserves safe comment marks and drops malformed payloads.
  - Comments do not break public form answer inputs or submission.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/shared exec vitest run src/__tests__/plate-content-utils.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-detail-publish-route.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/editor/plate-editor-internal.test.tsx"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run comment creation, persistence, and visibility checks."

## Task Waves
- Wave 1 (parallel): [Task_1, Task_2, Task_3]
- Wave 2 (parallel): [Task_4]

## E2E / Visual Validation Spec
- provider: playwright-cli
- artifact_root: `.playwright-cli/plate-review-experience/`
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev`
- readiness_check: "Web app responds on port 3000 and API responds on port 3001."
- flows:
  - Delete a question via keyboard and block UI; test cancel and confirm.
  - Create a conflict and verify readable diff rail.
  - Open a VIEWER share link and verify viewing mode/no edit.
  - Select text, add a comment, reload, and verify permission visibility.
- viewports:
  - desktop: 1440x900
  - mobile: 390x844
- evidence_requirements:
  - Screenshots for delete dialog, diff rail, viewer mode, comments.
  - Console/network errors summarized.
  - Keyboard focus behavior checked for dialogs and comments.
- known_flakiness:
  - Use deterministic conflict fixtures; avoid timing-dependent concurrent editing.

## Rollback / Safety
- Gate comments to editor-only visibility first if public/share rendering risk appears.
- Keep internal ids accessible in diff details for debugging.

## Progress Log
- 2026-07-06 Draft created. Validation not run; planning only.
- 2026-07-06 Draft updated.
  - Summary: Added security finding #4 pending-save replay constraint to viewer share-link work.
  - Validation evidence: Not run; planning only.
  - Notes: Detailed remediation tracking lives in `security-findings-remediation-plan.md`.

## Decision Log
- 2026-07-06 Decision:
  - Trigger / new insight: Issues 7-10 all affect Plate editing/review surfaces and share-view rendering.
  - Plan delta: Split Plate review experience into its own plan.
  - Tradeoffs considered: Comments could be separate, but it depends on viewing-mode permission decisions.
  - User approval: no

## Notes
- Risk: Plate comment persistence may require careful sanitizer changes to avoid dropping safe comment marks.
