# Plan: Copy Feedback UI

- status: completed
- generated: 2026-07-06
- last_updated: 2026-07-06
- work_type: code

## Goal
- Fix issue 12: make URL/token/copy buttons provide immediate, visible feedback so users can tell the click worked.

## Definition of Done
- Copy buttons show local feedback such as icon/text/state change, not only a toast.
- Existing clipboard fallbacks still work.
- Public URL, regenerated URL, share link, prefill URL, API token, and admin lookup-key copy flows have consistent success/failure behavior.
- Feedback is accessible through button text/ARIA/live region and resets after a short timeout.
- Required targeted tests plus UI E2E pass.

## Scope / Non-goals
- Scope:
  - `apps/web/src/components/forms/public-url-copy-field.tsx`
  - `apps/web/src/components/forms/form-public-url-settings.tsx`
  - `apps/web/src/components/forms/form-sharing-section.tsx`
  - `apps/web/src/components/forms/share-link-manager.tsx`
  - `apps/web/src/components/forms/form-prefill-generator.tsx`
  - `apps/web/src/components/forms/schedule-manager.tsx`
  - `apps/web/src/components/tokens/tokens-page.tsx`
  - optional shared helper/hook under `apps/web/src/hooks/**` or `apps/web/src/components/ui/**`
  - related tests in the same areas
- Non-goals:
  - No redesign of sharing settings layout.
  - No change to the underlying copied URL/token formats.
  - No browser permission prompt customization beyond handling success/failure.

## Context (workspace)
- `form-prefill-generator.tsx` already has copy feedback and can be used as a behavior reference.
- `tokens-page.tsx` shows "コピー済み" inside the token reveal dialog.
- `public-url-copy-field.tsx` currently only uses toast feedback on success.
- `share-link-manager.tsx` uses toast and a manual-copy panel on failure, but its copy icon does not show a successful pressed/copied state.
- Repo rule suite is absent: `docs/coding-agent/rules` does not exist.

## Open Questions (max 3)
- Q1: Should icon-only copy buttons expand to "コピー済み" text, or keep stable width and switch to a check icon with tooltip/ARIA label?
- Q2: Should all copy success toasts remain, or should local feedback replace toasts for less noise?

## Assumptions
- A1: Keep existing success toasts initially, but add local feedback so the clicked control itself confirms success.
- A2: Icon-only buttons should keep stable dimensions and switch icon/ARIA text to avoid layout shift.
- A3: Use `window.setTimeout` for reset handles in frontend code.

## Tasks

### Task_1: Add reusable copy feedback primitive
- type: impl
- owns:
  - `apps/web/src/hooks/**`
  - `apps/web/src/components/ui/**`
  - `apps/web/src/components/forms/public-url-copy-field.tsx`
- depends_on: []
- description: |
  Introduce a small reusable hook/component pattern for copied/error/reset state, with stable dimensions and accessible labels.
- acceptance:
  - Copy state can represent idle, copied, and failed/manual fallback.
  - Reset timer uses `window.setTimeout` and cleans up.
  - Button aria-label/title changes after successful copy.
  - `PublicUrlCopyField` uses the primitive.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-public-url-settings.test.tsx src/components/forms/form-sharing-section-public-url.test.tsx"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review accessibility labels, stable dimensions, and cleanup behavior."

### Task_2: Apply copy feedback to sharing and generated URL flows
- type: impl
- owns:
  - `apps/web/src/components/forms/share-link-manager.tsx`
  - `apps/web/src/components/forms/share-link-manager.test.tsx`
  - `apps/web/src/components/forms/form-prefill-generator.tsx`
  - `apps/web/src/components/forms/form-prefill-generator.test.tsx`
  - `apps/web/src/components/forms/form-sharing-section.tsx`
- depends_on: [Task_1]
- description: |
  Make share-link and generated URL copy actions show local copied feedback while preserving manual-copy fallback panels.
- acceptance:
  - Share-link copy icon switches to a copied state for the clicked link only.
  - Manual-copy fallback still appears on failure.
  - Prefill generator behavior remains covered and aligns with shared feedback timing.
  - Feedback clears when copied URL/link changes or is deleted.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/share-link-manager.test.tsx src/components/forms/form-prefill-generator.test.tsx"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run public URL, share link, and prefill URL copy flows."

### Task_3: Apply copy feedback to token and admin utility copy flows
- type: impl
- owns:
  - `apps/web/src/components/tokens/tokens-page.tsx`
  - `apps/web/src/components/tokens/tokens-page.test.tsx`
  - `apps/web/src/components/forms/schedule-manager.tsx`
  - `apps/web/src/components/forms/schedule-manager.test.tsx`
- depends_on: [Task_1]
- description: |
  Align API token reveal and schedule/admin lookup-key copy feedback with the shared pattern.
- acceptance:
  - API token copy keeps visible copied state and failure toast.
  - Schedule/admin lookup-key copy gives local feedback near the clicked control where a button exists.
  - Tests cover success, failure, and reset.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/tokens/tokens-page.test.tsx src/components/forms/schedule-manager.test.tsx"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review consistency with sharing copy controls and no layout shifts."

## Task Waves
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2, Task_3]

## E2E / Visual Validation Spec
- provider: playwright-cli
- artifact_root: `.playwright-cli/copy-feedback-ui/`
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev`
- readiness_check: "Web app responds on port 3000 and API responds on port 3001."
- flows:
  - Copy current public URL and regenerated public URL.
  - Copy a share link successfully and verify only that row shows copied feedback.
  - Simulate share-link clipboard failure and verify manual copy panel remains.
  - Generate and copy a prefill URL.
  - Create an API token and copy it from the reveal dialog.
- viewports:
  - desktop: 1440x900
  - mobile: 390x844
- evidence_requirements:
  - Screenshots of idle, copied, and failure/manual-copy states.
  - Console/network errors summarized.
  - ARIA labels or accessible names checked for copied state.
- known_flakiness:
  - Clipboard API should be mocked for deterministic success/failure states.

## Rollback / Safety
- Keep existing toasts and fallback copy paths while adding local feedback.
- If a shared primitive causes churn, land the behavior first in `PublicUrlCopyField` and `ShareLinkManager`, then harmonize.

## Progress Log
- 2026-07-06 Draft created.
  - Summary: Planned consistent local feedback for copy controls across URL, share link, token, and utility copy flows.
  - Validation evidence: Not run; planning only.
  - Notes: Existing prefill URL copy feedback is the closest behavior reference.

## Decision Log
- 2026-07-06 Decision:
  - Trigger / new insight: Copy buttons currently rely inconsistently on toasts or no visible local state, making click success unclear.
  - Plan delta: Added a separate UI plan instead of folding copy feedback into unrelated form completion or Plate work.
  - Tradeoffs considered: Toast-only feedback is already present in some areas, but local state on the clicked button better answers whether the click worked.
  - User approval: no

## Notes
- Risk: text changes inside small icon buttons can cause layout shift; prefer fixed-size check icon plus accessible label for compact controls.
