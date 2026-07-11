# Plan: Public Password Request Bounds

- status: complete
- generated: 2026-07-11
- last_updated: 2026-07-11
- work_type: code

## Goal
- Bound unauthenticated public password-verification input before JSON materialization and password hashing.

## Definition of Done
- Request body and password length have explicit conservative limits.
- Oversized Content-Length and streamed/chunked bodies fail with stable 4xx responses before hashing.
- Normal password verification remains compatible.

## Scope / Non-goals
- Scope: `/public/:publicId/verify-password`, request-size middleware reuse, schemas and focused tests.
- Non-goals: changing bcrypt parameters, global API payload limits, CAPTCHA policy.

## Tasks

### Task_1: Define and apply password/body limits
- type: impl
- owns:
  - apps/api/src/routes/forms-public.ts
  - apps/api/src/lib/request-body-size-limit.ts
- depends_on: []
- description: Add a shared constant/schema maximum and a small route-specific streaming body-size limit before `zValidator` and hashing.
- acceptance:
  - Password maximum is defined once and enforced at runtime.
  - Oversized bodies are rejected before `verifyPassword` executes.
  - Error status/body follow existing public-route conventions.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Verify middleware order and that both declared and streamed sizes are bounded."

### Task_2: Add boundary and bypass regression tests
- type: test
- owns:
  - apps/api/src/__tests__/forms-structure-password-protection.test.ts
  - apps/api/src/__tests__/response-body-size-limit.test.ts
  - apps/api/src/__tests__/forms-public-password-request-limit.test.ts
- depends_on: [Task_1]
- acceptance:
  - Tests cover exact maximum, maximum+1, oversized Content-Length, streamed body, invalid JSON, and ordinary valid/invalid passwords.
  - Tests assert hashing is not called for rejected oversized input.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-public-password-request-limit.test.ts src/__tests__/response-body-size-limit.test.ts"

### Task_3: Final validation and review
- type: review
- owns: []
- depends_on: [Task_2]
- acceptance:
  - Reviewer status is `APPROVED`.
  - Repository checks pass.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm lint:fix && pnpm type-check && pnpm test --silent"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent unauthenticated resource-exhaustion review."

## Task Waves
- Wave 1: [Task_1]
- Wave 2: [Task_2]
- Wave 3: [Task_3]

## Rollback / Safety
- If compatibility requires a larger password limit, raise the bounded constant; do not remove streaming body enforcement.

## Progress Log
- 2026-07-11: Draft created.
- 2026-07-11: Tasks 1-2 merged through PR #663 with shared plaintext bounds, early declared/streamed body cancellation, stored-structure compatibility, and 23 focused parent tests. Task 3 repository/CI validation and independent resource/API reviews completed APPROVED.

## Decision Log
- 2026-07-11: Isolated as a small boundary-hardening plan with no UI or authentication-state dependency.
