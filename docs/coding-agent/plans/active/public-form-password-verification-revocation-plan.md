# Plan: Public Form Password Verification Revocation

- status: draft
- generated: 2026-07-11
- last_updated: 2026-07-11
- work_type: code

## Goal
- Invalidate previously verified public-form sessions whenever the effective published password credential changes.

## Definition of Done
- Old verification grants fail after password change, disable/re-enable, or credential replacement.
- Unrelated form sessions and currently valid grants remain usable.
- Rolling deployment and legacy JWT behavior are explicitly fail-closed.

## Scope / Non-goals
- Scope: public-form session JWT schema, verification/access checks, access-control publication tests.
- Non-goals: Better Auth sessions, editor authentication, changing password hash algorithm.

## Context
- Current JWT stores `sessionId` and `verifiedForms[]` for 14 days.
- Published snapshot data is authoritative for respondent access.

## Assumptions
- A signed opaque credential revision can be derived without exposing the stored password hash.
- Legacy form verification claims may require one-time re-verification after rollout.

## Tasks

### Task_1: Define a versioned verification-grant contract
- type: design
- owns:
  - apps/api/src/lib/sessions/jwt.ts
  - apps/api/src/lib/forms/public-structure.ts
- depends_on: []
- description: Design a Zod-validated JWT claim that binds each verified form to the effective published password credential revision.
- acceptance:
  - Claim does not expose raw or hashed passwords.
  - Missing/legacy revision fails closed only for protected forms.
  - Unprotected-form session behavior remains compatible.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Security review of claim contents, derivation, and rolling-deploy behavior."

### Task_2: Enforce credential revision on public access
- type: impl
- owns:
  - apps/api/src/lib/sessions/jwt.ts
  - apps/api/src/routes/forms-public.ts
- depends_on: [Task_1]
- description: Issue revision-bound grants at password verification and compare them with the current published structure for GET and submit.
- acceptance:
  - Password change invalidates prior grants immediately after publication.
  - Disable/re-enable cannot resurrect a prior grant.
  - Multiple verified forms in one session retain independent revisions.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run focused API tests for public password verification and submit authorization."

### Task_3: Add revocation regression tests
- type: test
- owns:
  - apps/api/src/__tests__/forms-structure-password-protection.test.ts
  - apps/api/src/__tests__/forms-public-validation-outbox.test.ts
  - apps/api/src/lib/sessions/__tests__/**
- depends_on: [Task_2]
- acceptance:
  - Tests cover password A verification followed by publication of password B.
  - Tests cover disable/re-enable and two independently verified forms.
  - Tests prove legacy JWTs cannot bypass a protected form.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/forms-structure-password-protection.test.ts src/__tests__/forms-public-validation-outbox.test.ts"

### Task_4: Final validation and review
- type: review
- owns: []
- depends_on: [Task_3]
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
    detail: "Independent auth-state and compatibility review."

## Task Waves
- Wave 1: [Task_1]
- Wave 2: [Task_2]
- Wave 3: [Task_3]
- Wave 4: [Task_4]

## Rollback / Safety
- Prefer forced re-verification over accepting an ambiguous legacy grant; document rollout impact.

## Progress Log
- 2026-07-11: Draft created.

## Decision Log
- 2026-07-11: Isolated from general access-control work because it changes a security credential lifecycle and JWT compatibility contract.

