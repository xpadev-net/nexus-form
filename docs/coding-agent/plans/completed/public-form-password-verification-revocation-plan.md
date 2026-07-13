# Plan: Public Form Password Verification Revocation

- status: complete
- generated: 2026-07-11
- last_updated: 2026-07-14
- work_type: mixed

## Goal
- Invalidate previously verified public-form sessions whenever the effective published password credential changes.

## Definition of Done
- Old verification grants fail after password change, disable/re-enable, or credential replacement.
- Unrelated form sessions and currently valid grants remain usable.
- Rolling deployment and legacy JWT behavior are explicitly fail-closed.

## Scope / Non-goals
- Scope: persistent public password grant generation, all publication lifecycle writers, public-form session JWT schema, verification/access checks, rollout cutoff, and access-control publication tests.
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
- status: complete

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
- status: stopped; split into Task_5, Task_6, Task_7, and Task_8 after security lifecycle review

### Task_3: Add revocation regression tests
- type: test
- owns:
  - apps/api/src/__tests__/forms-structure-password-protection.test.ts
  - apps/api/src/__tests__/authz-regression.test.ts
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
- status: stopped; replaced by Task_6 and Task_8 real lifecycle and route regressions

### Task_5: Add persistent public password grant generation
- type: impl
- owns:
  - packages/database/src/schema.ts
  - packages/database/drizzle/0017_*.sql
  - packages/database/drizzle/meta/_journal.json
  - packages/database/drizzle/meta/0017_snapshot.json
  - packages/database/src/migrate.ts
  - apps/api/src/__tests__/database-migration-journal.test.ts
  - apps/api/src/__tests__/database-snapshot-structure-migration.test.ts
- depends_on: [Task_1]
- description: Add an additive, non-reusable public password grant generation field and resumable MySQL migration without changing lifecycle writers yet.
- acceptance:
  - Existing forms receive a safe generation default and remain readable by old code during rolling deployment.
  - The generation is a monotonic integer with no dependency on wall-clock precision, snapshot version reuse, or password hash reuse.
  - Migration DDL is restart-safe after every MySQL auto-commit boundary and journal/snapshot metadata remains consistent.
  - Schema ownership exposes the field needed by later atomic lifecycle writers without changing JWT or route behavior.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/database-migration-journal.test.ts src/__tests__/database-snapshot-structure-migration.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/database type-check && pnpm --filter @nexus-form/api type-check"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent additive-migration, partial-DDL restart, and rolling-reader compatibility review."
- status: complete

### Task_6: Advance generation at every authoritative publication lifecycle boundary
- type: impl
- owns:
  - apps/api/src/lib/forms/snapshot-repository.ts
  - apps/api/src/lib/forms/schedule-processor.ts
  - apps/api/src/routes/forms-detail.ts
  - apps/api/src/lib/forms/__tests__/snapshot-repository.test.ts
  - apps/api/src/lib/forms/__tests__/schedule-processor.test.ts
  - apps/api/src/__tests__/forms-detail-publish-route.test.ts
- depends_on: [Task_5]
- description: Atomically advance the persistent generation for direct/scheduled snapshot activation and protected publication enable/disable transitions, and expose it with the authoritative active publication view.
- acceptance:
  - Direct historical snapshot activation increments generation in the same transaction as the active-snapshot transition.
  - Scheduled historical activation uses the same authoritative writer and increments generation exactly once.
  - Direct and scheduled disable followed by re-enable with the same password cannot reuse a prior generation.
  - Read paths obtain active snapshot and generation from one authoritative database view without wall-clock or mutable business-state derivation.
  - Concurrent or retried lifecycle operations cannot decrement or reuse generation.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/lib/forms/__tests__/snapshot-repository.test.ts src/lib/forms/__tests__/schedule-processor.test.ts src/__tests__/forms-detail-publish-route.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api type-check"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent transaction, monotonicity, direct/scheduled parity, and retry review."
- status: complete

### Task_7: Define and enforce the rollout cutoff and rollback floor
- type: docs
- owns:
  - k8s/README.md
  - k8s/base/api-deployment.yaml
  - k8s/base/kustomization.yaml
  - k8s/base/secret.yaml
- depends_on: [Task_1]
- description: Document and template the expand/bridge/drain/secret-rotation rollout that prevents pre-fix pods or same-secret rollback from accepting legacy grants after cutoff.
- acceptance:
  - Runbook defines phase 0 additive migration, phase 1 bridge rollout and old-pod drain verification, and phase 2 AUTH_SECRET rotation.
  - Pre-fix rollback after phase 2 is explicitly forbidden; the minimum safe rollback floor is the bridge release.
  - Kubernetes templates express only secret/configuration contracts and never commit a real secret value.
  - Base and production Kustomize apply paths never include the placeholder Secret; one external secret-management path remains authoritative for `nexus-form-secrets`.
  - The old-token/new-binary, new-token/old-binary, and same-secret rollback matrix is explicit, including the phase-1 residual risk.
  - Operators have concrete zero-old-pod and post-rotation verification steps before enabling the final consumer contract.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "kustomize build k8s/base and kustomize build k8s/overlays/production"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent secret-handling, rollout sequencing, rollback-floor, and compatibility-matrix review."
- status: complete

### Task_8: Bind JWT grants and public routes to persistent generation
- type: impl
- owns:
  - apps/api/src/lib/sessions/jwt.ts
  - apps/api/src/routes/forms-public.ts
  - apps/api/src/lib/sessions/__tests__/jwt.test.ts
  - apps/api/src/__tests__/authz-regression.test.ts
  - apps/api/src/__tests__/forms-structure-password-protection.test.ts
  - apps/api/src/__tests__/forms-public-password-request-limit.test.ts
- depends_on: [Task_6, Task_7]
- description: Update existing PR #665 to issue and verify a runtime-validated generation-bound grant and prove real GET/submit lifecycle behavior.
- acceptance:
  - JWT claims bind each protected form to its non-reusable persistent generation without exposing raw or hashed passwords.
  - GET, submit, and verify-password use the authoritative generation and reject legacy or stale grants for protected forms.
  - Password A to B, disable then same-A re-enable, direct v3 to v8 to v3 activation, and scheduled historical activation never revive an old grant.
  - Legacy tokens are rejected on real protected GET and submit paths after the documented cutoff; unrelated/unprotected sessions remain compatible.
  - JWT tests decode the payload and structurally prove password and password-hash material is absent.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run focused JWT, public authz, and password-publication lifecycle tests covering GET and submit."
  - kind: command
    required: true
    owner: worker
    detail: "pnpm lint:fix && pnpm type-check && pnpm test --silent"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent auth-state, historical reactivation, rollout matrix, secret disclosure, and compatibility review."
- status: complete

### Task_4: Final validation and review
- type: review
- owns: []
- depends_on: [Task_8]
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
- status: complete

## Task Waves
- Wave 1: [Task_1]
- Wave 2 (parallel): [Task_5, Task_7]
- Wave 3: [Task_6]
- Wave 4: [Task_8]
- Wave 5: [Task_4]

## Rollback / Safety
- Prefer forced re-verification over accepting an ambiguous legacy grant.
- Phase 1 may roll back only before the security cutoff and retains the documented old-pod legacy risk.
- After old pods are drained and `AUTH_SECRET` is rotated, rollback below the bridge release is forbidden because pre-fix code cannot interpret the cutoff and will accept/reissue legacy grants.

## Progress Log
- 2026-07-11: Draft created.
- 2026-07-11: Task_1 security design approved. Use V2 `verifiedFormGrants[{formId,revision}]`, keep legacy claims parseable but invalid for protected forms, and derive a form-scoped opaque HMAC revision from the effective published credential generation without exposing raw or hashed passwords.
- 2026-07-13: Task_2/3 implementation was stopped after independent review reproduced grant revival through historical snapshot reactivation and proved that same-secret rollback to pre-fix code remains fail-open. No additional replacement-worker edits were made; existing PR #665 is retained for downstream Task_8.
- 2026-07-13: Split execution into additive generation schema/migration (Task_5), authoritative lifecycle writers (Task_6), rollout cutoff/rollback floor (Task_7), and downstream JWT/routes/tests (Task_8).
- 2026-07-13: Task_7 Reviewer found that the production overlay still rendered and applied the placeholder Secret despite the external-secret runbook. Expanded Task_7 ownership narrowly to `k8s/base/kustomization.yaml`; the implementation must remove the placeholder Secret from base/production apply output and add executable old-cookie/new-cookie GET and submit smoke evidence before re-review.
- 2026-07-14: Task_5 merged through PR #668 as `4ac39633fd366a70829633ad1de38ab49a8a9ccc`. Formal Reviewer approved the exact eight product blobs after independently passing static 16 tests and MySQL 8.4/Drizzle 20 tests. Parent deep-review found no issues; parent hook exited 0; lint, type-check, full tests, focused migration tests, schema staged check, CI, and AI review gates passed. Task_6 is now dependency-ready.
- 2026-07-14: Task_6 merged through PR #671 as `b68c08afe8573588670ee2df084646097700fc43`. Formal review verified consistent schedule lock order, atomic CAS/activation/generation rollback, idempotent lifecycle transitions, and bigint-safe authoritative reads; parent focused 46 tests, API/workspace type-check, lint, full tests, hook, CI, and AI review gates passed. Task_8 now waits only for Task_7.
- 2026-07-14: Task_7 merged through PR #673 as `9894f818e7747cee7690d472f74aa21ef7e925c9`. Formal review verified Bash 3.2/5.3 cleanup, failure diagnostics, confidentiality, durable recovery, Kustomize Secret authority, rollout cutoff, compatibility matrix, and rollback floor; parent deep-review, hook, lint, type-check, full tests, focused 54 tests, Bash fence syntax, Kustomize renders, CI, and AI review gates passed.
- 2026-07-14: Started Task_8 Worker `019f5c96-4dc7-7143-a881-906bdc22dd52` from the preserved PR #665 branch in a new isolated worktree. The Worker owns only JWT/public-route consumers and focused lifecycle regressions and must stop at REVIEW_READY for parent-dispatched formal review.
- 2026-07-14: Expanded Task_8 ownership by one test-only file, `apps/api/src/__tests__/forms-public-password-request-limit.test.ts`, after its existing snapshot-repository mock lacked the authoritative `getActivePublication` export and caused three unrelated 500 responses in the required full suite. The same Task_8 Worker may update only that mock to return the snapshot plus bigint generation; no product scope was added.
- 2026-07-14: Task_8 merged through PR #665 as `cfb6161d89d99b83524527836730bf674597d3db`. Formal review approved the exact five product blobs and independently verified bigint-safe persistent-generation binding, opaque payload secrecy, authoritative protected GET/submit/verify-password parity, legacy rejection, and password/lifecycle invalidation. Parent deep-review found no issues; hook exit 0, lint, API/workspace type-check, full tests, focused 108 tests, CI, and AI review gates passed. Task_4 is complete and this plan is archived.

## Decision Log
- 2026-07-11: Isolated from general access-control work because it changes a security credential lifecycle and JWT compatibility contract.
- 2026-07-11: Protected legacy grants fail closed; unprotected access remains compatible. Revision derivation binds form identity, effective published snapshot/generation, and password hash so password replacement and disable/re-enable cannot resurrect an old grant.
- 2026-07-13: The original deterministic snapshot-version/password-hash revision is insufficient because historical snapshots are reactivatable. Use a persistent non-reusable generation advanced by every authoritative publication lifecycle writer.
- 2026-07-13: Same-secret rollback to a pre-fix binary cannot be made fail-closed by new-code changes. Adopt bridge rollout, verify old-pod drain, rotate `AUTH_SECRET`, and enforce a bridge-release rollback floor before Task_8 can merge.
- 2026-07-13: Research dispatch waived because the stopped Worker supplied a clean-worktree reproduction, exact direct/scheduled lifecycle anchors, schema inventory, and the full old/new token/binary compatibility matrix; the Orchestrator split that evidence into bounded tasks.
- 2026-07-13: The checked-in `secret.yaml` remains a placeholder contract only and must not be a Kustomize resource. External secret management is the sole authoritative writer for the runtime `nexus-form-secrets` object; rendering/applying base or production must not overwrite it.
- 2026-07-14: Keep the request-limit mock repair in Task_8 because it is a direct compatibility update for the same `forms-public` authoritative-read contract and is required for the full-suite gate; a separate PR would create an unnecessary dependency without isolating product behavior.
