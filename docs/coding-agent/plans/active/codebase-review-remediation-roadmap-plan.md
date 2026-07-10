# Plan: Codebase Review Remediation Roadmap

- status: draft
- generated: 2026-07-11
- last_updated: 2026-07-11
- work_type: code

## Goal
- Coordinate remediation of the verified whole-codebase review findings through independently executable, reviewable plans.

## Definition of Done
- Every verified finding is owned by exactly one child plan.
- Child-plan dependencies and recommended execution order are explicit.
- Every child plan reaches Reviewer `APPROVED` with required repository checks passing.

## Scope / Non-goals
- Scope: orchestration and coverage tracking for the eight child plans below.
- Non-goals: implementation work in this roadmap file; duplicating child-plan tasks.

## Context (workspace)
- Source review: `docs/coding-agent/plans/completed/codebase-comprehensive-review-plan.md`.
- Repo rule suite: absent; validation follows repository `AGENTS.md`/`CLAUDE.md` and harness requirements.
- Child plans:
  1. `k8s-runtime-wiring-hardening-plan.md`
  2. `public-form-password-verification-revocation-plan.md`
  3. `sensitive-request-log-redaction-plan.md`
  4. `validation-outbox-retry-recovery-plan.md`
  5. `external-validation-plugin-timeout-plan.md`
  6. `web-api-error-and-discord-auth-ux-plan.md`
  7. `realtime-e2e-auth-fixture-plan.md`
  8. `public-password-request-bounds-plan.md`

## Open Questions (max 3)
- None. Implementation-specific tradeoffs are isolated in the relevant child plan.

## Assumptions
- Each child plan may be executed in a separate branch/worktree.
- Shared-state Git operations remain Orchestrator-owned.

## Task Sizing Guardrails
- A Worker Task owns one primary behavior and one runtime boundary.
- Split before dispatch when a Task combines schema/migration work with runtime behavior, spans independent providers, or mixes product code with CI/E2E infrastructure.
- Prefer at most four production files and one package/app per implementation Task; exceed only when files form one inseparable contract and record the reason.
- Keep regression tests in a separate Task when implementation and failure-matrix coverage can be reviewed independently.
- Replan when a Worker discovers a second independently shippable behavior, more than six acceptance criteria, or required edits outside `owns`.

## Finding Coverage

| Review finding | Child plan |
|---|---|
| Missing `TRUSTED_ORIGINS` and notification consumer in Kubernetes | `k8s-runtime-wiring-hardening-plan.md` |
| Password verification survives password changes | `public-form-password-verification-revocation-plan.md` |
| Invite/share/OAuth secrets in request logs | `sensitive-request-log-redaction-plan.md` |
| Validation enqueue failures become permanently terminal | `validation-outbox-retry-recovery-plan.md` |
| External plugin can hold Worker indefinitely | `external-validation-plugin-timeout-plan.md` |
| Nested API errors and Discord login failures are not presented correctly | `web-api-error-and-discord-auth-ux-plan.md` |
| Realtime collaboration E2E uses obsolete authentication | `realtime-e2e-auth-fixture-plan.md` |
| Public password verification accepts unbounded input | `public-password-request-bounds-plan.md` |

## Tasks

### Task_1: Execute security-boundary plans
- type: review
- owns: []
- depends_on: []
- description: Execute Kubernetes wiring, password revocation, log redaction, and public request-bound plans through their own files.
- acceptance:
  - All four child plans are completed or explicitly waived with evidence.
  - No security child plan has an unresolved Reviewer finding.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "Reconcile child-plan completion evidence against the finding coverage table."

### Task_2: Execute reliability-boundary plans
- type: review
- owns: []
- depends_on: []
- description: Execute validation outbox recovery and external plugin timeout plans.
- acceptance:
  - Both reliability child plans are completed or explicitly waived with evidence.
  - Retry, cancellation, and terminal-state semantics are independently reviewed.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "Confirm failure-injection and lifecycle evidence from both child plans."

### Task_3: Execute frontend and E2E plans
- type: review
- owns: []
- depends_on: [Task_1]
- description: Execute API error/auth UX and realtime E2E authentication plans.
- acceptance:
  - User-visible auth failures have browser evidence.
  - Realtime collaboration tests use a supported deterministic auth fixture and run in CI.
- validation:
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Review child-plan Playwright evidence for login failure/recovery and realtime collaboration."

### Task_4: Final remediation closure
- type: review
- owns: []
- depends_on: [Task_1, Task_2, Task_3]
- description: Re-run repository validation and confirm all review findings are closed.
- acceptance:
  - All eight child plans are complete or explicitly waived.
  - Reviewer status is `APPROVED` for the combined remediation.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm lint:fix && pnpm type-check && pnpm test --silent"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent cross-plan review for contract drift and missing finding coverage."

## Task Waves
- Wave 1 (parallel): [Task_1, Task_2]
- Wave 2 (parallel): [Task_3]
- Wave 3 (parallel): [Task_4]

## Rollback / Safety
- Merge child plans independently; revert a child change without reverting unrelated remediation.
- Security fixes must fail closed and document compatibility effects before rollout.

## Progress Log
- 2026-07-11: Draft roadmap created; implementation not started.
- 2026-07-11: Nine-file plan set passed structural checks and independent Reviewer validation (`APPROVED`); implementation remains unstarted.
- 2026-07-11: Re-audited every Worker Task for size/complexity after user correction; split Kubernetes, Outbox, plugin-provider, and realtime E2E work. Independent task-size Reviewer returned `APPROVED`.

## Decision Log
- 2026-07-11: Split by runtime boundary and validation method; retained only Kubernetes and frontend error-UX pairings where files and acceptance evidence materially overlap.
- 2026-07-11: Moved plugin timeout environment/default validation acceptance into the Task that owns `apps/worker/src/lib/env.ts` after Reviewer identified an `owns` mismatch.
- 2026-07-11: Added task-size guardrails and split cross-boundary/provider tasks after user correction; future dispatch must perform this sizing check before approval.

## Notes
- Quality routing: L3; top risks are security, data integrity, concurrency, external dependencies, contracts, and CI validity.
