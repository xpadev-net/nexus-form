# R25-L3 Duplicate And Archive UX Verification

## Automated Coverage

- `apps/web/src/components/forms/form-editor-page.test.tsx`
  - Dirty title drafts are previewed in the duplicate dialog.
  - The title save request is awaited before the duplicate request.
- `apps/web/src/components/forms/form-duplicate-archive-actions.test.tsx`
  - The duplicate dialog shows the destination title and copy policy.
- `apps/web/src/components/forms/form-list.test.tsx`
  - The home list exposes archived forms, filters to them, and restores one.
- `apps/api/src/__tests__/forms-detail-duplicate-route.test.ts`
  - Duplicate forms receive a fresh `publicId`, remain draft, and do not copy response/share-link data in the covered route path.

## Manual QA

1. Create a disposable form, type a new title in the editor header, and immediately duplicate it from Settings.
2. Confirm the duplicate dialog previews `<typed title> のコピー`.
3. Confirm the created duplicate keeps that title, has a different public URL, starts as draft, and has no responses.
4. Archive the disposable duplicate from Settings.
5. Return home, use `アーカイブを表示`, and restore it with the row-level `復元` button.
