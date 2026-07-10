# Plan: Web API Error and Discord Auth UX

- status: draft
- generated: 2026-07-11
- last_updated: 2026-07-11
- work_type: code

## Goal
- Normalize structured API errors and make Discord login initiation failures visible, actionable, and non-duplicative.

## Definition of Done
- Nested and flat API errors produce a safe string message without unchecked casts.
- Discord login has pending, failure, and retry behavior.
- Unit/component and browser evidence cover the user-visible flows.

## Scope / Non-goals
- Scope: Web RPC error normalization, Discord sign-in hook/button/section, focused tests.
- Non-goals: backend error-envelope migration, login-page visual redesign, new authentication providers.

## Tasks

### Task_1: Define a runtime-validated client error envelope
- type: impl
- owns:
  - apps/web/src/lib/api.ts
  - apps/web/src/lib/api-error.ts
  - apps/web/src/lib/api.test.ts
- depends_on: []
- description: Parse unknown error JSON with Zod and extract nested `error.message`, flat `error`, flat `message`, code, and details safely.
- acceptance:
  - `{error:{message,code}}` yields the nested message and preserves details/code.
  - Malformed/non-JSON bodies fall back to `HTTP <status>`.
  - No `any` or unchecked `as` is introduced at the response boundary.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/lib/api.test.ts"

### Task_2: Surface Discord sign-in state and errors
- type: impl
- owns:
  - apps/web/src/hooks/auth/use-auth.ts
  - apps/web/src/components/auth/discord-signin-button.tsx
  - apps/web/src/components/auth/signin-section.tsx
- depends_on: [Task_1]
- description: Handle both rejected promises and Better Auth resolved error results; disable duplicate submission and present recovery text.
- acceptance:
  - Button exposes a pending state and cannot be double-triggered.
  - Network/provider/resolved-value errors produce user-safe feedback.
  - Failure preserves callback destination and permits retry.
  - Error announcement uses an accessible live region or alert semantics.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Review error taxonomy, pending-state lifecycle, focus, and accessible announcement."

### Task_3: Add unit and component coverage
- type: test
- owns:
  - apps/web/src/hooks/auth/use-auth.test.ts
  - apps/web/src/components/auth/discord-signin-button.test.tsx
  - apps/web/src/components/auth/signin-section.test.tsx
- depends_on: [Task_2]
- acceptance:
  - Tests cover rejected promise, resolved error, success redirect handoff, double click, retry, and accessible error copy.
  - Tests use role/name queries for the sign-in control and alert.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run focused Web auth/API Vitest files."

### Task_4: Browser acceptance validation
- type: review
- owns: []
- depends_on: [Task_3]
- acceptance:
  - Reviewer demonstrates pending and failure/retry flows in a real browser.
  - No unexpected console error or unhandled rejection occurs.
- validation:
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run the E2E spec below with playwright-cli."

### Task_5: Repository validation and final review
- type: review
- owns: []
- depends_on: [Task_4]
- acceptance:
  - Reviewer status is `APPROVED`.
  - Required repository checks pass.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm lint:fix && pnpm type-check && pnpm test --silent"

## Task Waves
- Wave 1: [Task_1]
- Wave 2: [Task_2]
- Wave 3: [Task_3]
- Wave 4: [Task_4]
- Wave 5: [Task_5]

## E2E / Visual Validation Spec
- provider: playwright-cli
- artifact_root: `.playwright-cli/web-api-error-discord-auth/`
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev`
- readiness_check: Web 3000 and API 3001 respond.
- flows: mock Discord initiation pending; resolved provider error; rejected network request; successful handoff.
- viewports: desktop 1440x900; mobile 390x844.
- evidence_requirements: screenshots of failure/pending states; console and network summary; keyboard focus/retry evidence.
- known_flakiness: intercept the OAuth initiation request; do not depend on live Discord.

## Rollback / Safety
- Preserve sanitized fallback messages if detailed parsing fails; never display raw upstream payloads.

## Progress Log
- 2026-07-11: Draft created.

## Decision Log
- 2026-07-11: Grouped both findings because RPC normalization is the shared error boundary used by the login UX.

