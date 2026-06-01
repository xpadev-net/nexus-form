# Plan: R15-C1 Fingerprint Limit

- status: in_progress
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal
- Fingerprint-required public submissions accept the combined FingerprintJS, ThumbmarkJS, and browser payload without exceeding the API contract.

## Definition of Done
- API and Web submit caps are aligned.
- Fingerprint-required public submission accepts a full payload at the supported cap and rejects payloads above it.
- Web submit payload is capped before sending.
- Required validation and independent review are complete.
- PR is pushed, reviewed with `gh-review-hook` exit 0, and merged.

## Scope / Non-goals
- Scope:
  - `apps/api/src/routes/forms-public.ts`
  - `apps/api/src/__tests__/authz-regression.test.ts`
  - `apps/web/src/hooks/fingerprint/use-fingerprint.ts`
  - `apps/web/src/components/forms/public-form-page.tsx`
  - `apps/web/src/components/forms/public-form-page.test.tsx`
- Non-goals:
  - Fingerprint library replacement.
  - Database schema changes.
  - Performance timing tests.

## Context (workspace)
- Related files/areas:
  - Public submit Zod schema and persistence path.
  - Web fingerprint collection and public form submit path.
- Existing patterns or references:
  - Existing `authz-regression.test.ts` public submit route mocks.
  - Existing `public-form-page.test.tsx` submit payload tests.
- Repo reference docs consulted:
  - AGENTS/CLAUDE instructions from prompt.
  - `RTK.md`.
  - Orchestration harness skills.

## Open Questions
- None.

## Assumptions
- `z/tasks.md` is absent in this worktree; the parent prompt task body is authoritative.
- `origin/master` already contains the 200-cap implementation, so this branch will add missing regression coverage and any necessary small cleanup.

## Tasks

### Task_1: Inspect Current Fingerprint Flow
- type: research
- owns: []
- depends_on: []
- description: |
  Confirm the current API/Web fingerprint cap, payload shape, and test coverage gaps.
- acceptance:
  - Current cap and payload shape are identified.
  - Existing tests and missing coverage are identified.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "Researcher output and local inspection identify current state and gaps."

### Task_2: Add Regression Coverage
- type: test
- owns:
  - apps/api/src/__tests__/authz-regression.test.ts
  - apps/web/src/components/forms/public-form-page.test.tsx
- depends_on: [Task_1]
- description: |
  Add or adjust tests proving public submit accepts 200 fingerprints, rejects 201, and Web sends no more than 200.
- acceptance:
  - API route test accepts exactly 200 fingerprints for fingerprint-required public submit.
  - API route test rejects 201 fingerprints before DB work.
  - Web component test verifies the submit payload is capped at 200 and hashes are present.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/authz-regression.test.ts"
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/public-form-page.test.tsx"

### Task_3: Full Validation And Review
- type: review
- owns: []
- depends_on: [Task_2]
- description: |
  Run required repository validation and independent review, then address findings.
- acceptance:
  - `pnpm lint:fix` passes.
  - `pnpm type-check` passes.
  - `pnpm test --silent` passes.
  - Independent reviewer approves.
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
    detail: "Diff review against R15-C1 acceptance criteria."

### Task_4: PR, Review Hook, Merge
- type: chore
- owns: []
- depends_on: [Task_3]
- description: |
  Commit, push, create PR with `gh`, run `gh-review-hook` until exit 0, and merge.
- acceptance:
  - Branch is pushed.
  - PR URL is recorded.
  - `gh-review-hook` exits 0.
  - PR is merged and merge commit is recorded.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "gh pr create"
  - kind: command
    required: true
    owner: orchestrator
    detail: "gh-review-hook"
  - kind: command
    required: true
    owner: orchestrator
    detail: "gh pr merge"

## Task Waves
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]
- Wave 4 (parallel): [Task_4]

## Rollback / Safety
- Revert the task commit if regression coverage or cap alignment causes unexpected failures.
- No database migration is involved.

## Progress Log
- 2026-06-01 15:31 JST Wave 1 started.
  - Summary: Researcher dispatched; local inspection found API/Web cap currently at 200 and Web cap test already present.
  - Validation evidence: pending.
  - Notes: `z/tasks.md` is absent in this worktree.
- 2026-06-01 15:39 JST Wave 1 completed: [Task_1]
  - Summary: Researcher confirmed API/Web caps are 200 and identified missing API boundary coverage.
  - Validation evidence: Researcher report plus local inspection of `forms-public.ts`, `use-fingerprint.ts`, and `public-form-page.tsx`.
  - Notes: Route schema currently accepts `browser`, `fingerprintjs`, and `thumbmarkjs`.
- 2026-06-01 15:39 JST Wave 2 completed: [Task_2]
  - Summary: Added API 200/201 boundary tests and strengthened Web mixed-provider cap test.
  - Validation evidence: `pnpm --filter @nexus-form/api exec vitest run src/__tests__/authz-regression.test.ts` passed; `pnpm --filter @nexus-form/web exec vitest run src/components/forms/public-form-page.test.tsx` passed.
  - Notes: Built packages first because targeted Vitest needed workspace package `dist` entries.
- 2026-06-01 15:54 JST Wave 3 validation completed: [Task_3]
  - Summary: Required repository validation passed; independent reviewer dispatched.
  - Validation evidence: `pnpm lint:fix` passed; `pnpm type-check` passed; `pnpm test -- --silent` passed; `git diff --check` passed.
  - Notes: `pnpm test --silent` failed before test execution because Turbo 2.9 rejects top-level `--silent`; reran with pass-through syntax.
- 2026-06-01 15:58 JST Wave 3 review completed: [Task_3]
  - Summary: Independent Reviewer returned `APPROVED` with no findings.
  - Validation evidence: Reviewer confirmed API 200/201 boundary coverage, Web mixed-provider cap coverage, and validation evidence.
  - Notes: UI browser validation was not run because this change only updates tests and does not affect UI layout or navigation.

## Decision Log
- 2026-06-01 15:31 JST Decision:
  - Trigger / new insight: `origin/master` already has the 200-cap implementation.
  - Plan delta: Add/verify regression coverage rather than repeating the same cap change.
  - Tradeoffs considered: Avoid no-op PR; add focused tests that lock the expected behavior.
  - User approval: delegated by parent prompt.

## Notes
- Risks:
  - Existing route tests use broad DB mocks; assertions must prove validation boundaries without overfitting to implementation details.
- Edge cases:
  - Fingerprint-required forms with zero fingerprints still fail.
  - Payloads above the supported cap must fail before persistence.
