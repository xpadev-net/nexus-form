# R26-H2 Public Form Loading Cleanup Verification

## Automated Coverage

- `apps/web/src/components/forms/public-form-page.test.tsx`
  - Slow public form queries render only the page-level loading status.
  - After the query resolves to a long, multipage grid form, the loading status is unmounted and no `読み込み中...` text or live region remains.
- `apps/web/src/components/forms/form-body.test.tsx`
  - Long descriptions, multipage navigation, and grid content render through the real form body without loading text sharing the DOM.
- `apps/web/src/components/forms/form-preview-page.test.tsx`
  - Preview query loading renders only the preview loading status.
  - Loaded previews render the form body without overlapping loading status text.
- `apps/web/src/components/editor/plate-viewer.test.tsx`
  - Plate viewer Suspense fallback is a non-announced skeleton and does not render `読み込み中...`.

## Manual QA

1. Open a public form with throttled network and confirm the initial status disappears once questions are answerable.
2. Open a long, multipage public form containing grid questions and confirm no loading text overlaps the form body.
3. Open the preview page and switch versions, confirming the preview body and loading status are never shown together.
