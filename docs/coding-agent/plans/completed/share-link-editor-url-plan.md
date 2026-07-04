# Share Link Editor URL Plan

## Task_1
- type: impl
- owns:
  - apps/web/src/lib/api.ts
  - apps/web/src/lib/require-auth.ts
  - apps/web/src/routes/_authenticated/forms/$id/edit.tsx
  - apps/web/src/components/forms/form-editor-page/use-form-editor-page-model.ts
  - apps/api/src/lib/dual-auth.ts
- depends_on: []
- acceptance:
  - `/forms/:id/edit?shareToken=...` can load without a session.
  - Form API calls from the editor carry the share token as Bearer auth.
  - Server-side form auth accepts active, matching share-link Bearer tokens and enforces VIEWER/EDITOR role checks.
- validation:
  - required: true
    owner: orchestrator
    kind: test
    detail: targeted web/API tests for shared-link editor access

## Task_2
- type: impl
- owns:
  - apps/web/src/hooks/forms/use-share-links.ts
  - apps/web/src/components/forms/shared-form-page.tsx
  - apps/web/src/routes/forms/shared/$token.tsx
  - apps/web/src/components/forms/*sharing*.test.tsx
  - apps/web/src/routeTree.gen.ts
- depends_on: [Task_1]
- acceptance:
  - Newly generated share URLs use the normal editor route with `shareToken`.
  - The dedicated `/forms/shared/:token` page is removed.
  - Tests no longer assert that shared links have no edit target.
- validation:
  - required: true
    owner: orchestrator
    kind: test
    detail: targeted web sharing tests plus repository required checks

## Task Waves
- Wave 1: Task_1
- Wave 2: Task_2

## Progress Log
- Started implementation after user confirmed `/forms/shared/` should be removed.
- Implemented share-link Bearer fallback for form auth, normal editor-route share URLs, and removal of the frontend `/forms/shared/:token` route.
- Validation passed: targeted API/Web tests, `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent`.

## Decision Log
- User accepted keeping the shared token in query params because link possession is the permission model.
- Use the normal editor route as the shared URL surface: `/forms/{formId}/edit?shareToken={token}`.
