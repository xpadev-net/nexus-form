# Plan: Migration Runtime Package Resolution

- status: done
- generated: 2026-07-13
- last_updated: 2026-07-14
- work_type: code

## Goal
- Restore the standalone migration runner and API container startup by packaging `@nexus-form/database` in an ESM-resolvable runtime location and removing duplicate API-startup migrations.

## Definition of Done
- `/migration/run-migrations.mjs` resolves `@nexus-form/database` from the production image.
- The dedicated Kubernetes migration Job remains the only automatic migration executor; the API entrypoint starts the API after environment replacement.
- Regression checks, repository-required validation, independent subagent review, PR review hook, GitHub review decision, and merge gates all pass.
- The PR is merged only after `gh-review-hook` exits 0 and GitHub no longer reports `CHANGES_REQUESTED`.

## Scope / Non-goals
- Scope: production Docker image layout, API container entrypoint, deterministic runtime-wiring regression coverage, required validation, review, PR, and merge.
- Non-goals: database schema changes, local Compose orchestration redesign, unrelated Kubernetes wiring work.

## Context (workspace)
- Related files/areas: `Dockerfile`, `docker/start.mjs`, `scripts/run-migrations.mjs`, root test scripts, `k8s/base/api-migration-job.yaml`, `k8s/README.md`.
- Existing pattern: `pnpm deploy` puts the deployed package itself at the deploy root and dependencies under `node_modules`; the migration runner uses a bare ESM import.
- Repo reference docs consulted: repository `AGENTS.md`, orchestration harness, existing Kubernetes runtime-wiring plan, and `k8s/README.md`.
- Repo rule suite: absent (`docs/coding-agent/rules/` does not exist).

## Open Questions (max 3)
- None.

## Assumptions
- The checked-in Kubernetes design is canonical: a dedicated Sync hook Job applies migrations and API startup verifies schema readiness without applying migrations.
- A static regression check plus a production image build/resolution probe provides proportionate coverage without requiring a persistent external database.

## Tasks

### Task_1: Repair migration runtime packaging and API startup wiring
- type: impl
- owns:
  - Dockerfile
  - docker/start.mjs
  - scripts/check-container-runtime-wiring.mjs
  - scripts/check-container-runtime-wiring.test.mjs
  - package.json
- depends_on: []
- description: |
  Package the deployed database workspace package where `/migration/run-migrations.mjs` can resolve it, remove migration execution from the API entrypoint, and add deterministic regression coverage for both invariants.
- acceptance:
  - The production image contains the complete database production deploy closure under `/migration/node_modules/@nexus-form/database`, including package metadata, built `dist`, and nested production dependencies.
  - The migration runner keeps using the package's public bare import rather than a layout-specific relative path.
  - `docker/start.mjs` no longer starts migrations and still propagates API exit status and signals.
  - Regression tests fail if database package placement or the dedicated-Job startup boundary regresses.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "rtk node --test scripts/check-container-runtime-wiring.test.mjs"
  - kind: command
    required: true
    owner: worker
    detail: "rtk pnpm exec biome check Dockerfile docker/start.mjs scripts/check-container-runtime-wiring.mjs scripts/check-container-runtime-wiring.test.mjs package.json"

### Task_2: Validate and independently review the fix
- type: review
- owns: []
- depends_on: [Task_1]
- description: |
  Integrate the Worker report, run required repository and image checks, then repeat independent subagent review and fixes until no actionable findings remain.
- acceptance:
  - Production image build succeeds and image layout resolves `@nexus-form/database` from the migration runner location.
  - Repository-required lint, type-check, and test commands pass.
  - Independent Reviewer status is `APPROVED` with no actionable findings.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "rtk pnpm lint:fix"
  - kind: command
    required: true
    owner: orchestrator
    detail: "rtk pnpm type-check"
  - kind: command
    required: true
    owner: orchestrator
    detail: "rtk pnpm test --silent"
  - kind: command
    required: true
    owner: orchestrator
    detail: "Build the production API image and probe ESM resolution from /migration/run-migrations.mjs"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent migration/container/runtime-boundary review; repeat after fixes until APPROVED"

### Task_3: Publish, review-hook, and merge
- type: chore
- owns: []
- depends_on: [Task_2]
- description: |
  Commit and push the coherent fix, open a PR with `gh`, run `gh-review-hook`, address every actionable finding with validated commits and pushes, and merge only after all gates pass.
- acceptance:
  - Atomic commits are pushed on `codex/fix-migration-database-resolution` and a PR exists.
  - `gh-review-hook` exits 0 on the current remote HEAD.
  - GitHub review decision is not `CHANGES_REQUESTED`, required checks pass, the PR is mergeable, and local/remote HEADs match.
  - The PR is merged.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "Run gh-review-hook to exit 0 after each review-fix push"
  - kind: review
    required: true
    owner: orchestrator
    detail: "Verify gh pr metadata: reviewDecision, mergeStateStatus, checks, and headRefOid"

## Task Waves (explicit parallel dispatch sets)
- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]

## Rollback / Safety
- Revert the Dockerfile package-placement change and entrypoint change together if rollout validation fails; do not deploy an image whose standalone migration runner cannot resolve its package.
- Do not rewrite history or force-push if the branch gains an open PR.

## Progress Log (append-only)
- 2026-07-13: Research completed. Shared root cause confirmed for migration Job and API startup; branch created and Task_1 prepared for Worker dispatch.
- 2026-07-13: Wave 1 / Task_1 completed and integrated. Worker changed only declared `owns`; 9 runtime-wiring tests and the supported-file Biome check passed. The exact `pnpm exec biome` wrapper aborted before Biome because pnpm attempted a non-TTY modules purge, so the installed project binary was used as the planned closest applicable fallback.
- 2026-07-13: Orchestrator deploy-layout probe found a false transitive-package failure because it built database without first building shared. A clean Researcher reproduction using the Docker builder order proved migration and API workspace imports succeed after all workspace builds, and recommended replacing the fragmented database COPY with one complete deploy-closure COPY. Task_1 returned for revision.
- 2026-07-13: Wave 1 / Task_1 revision completed and integrated. The Worker replaced fragmented copies with one complete deploy-closure COPY, added closure-absence and fragmented-layout regression cases, and passed all 9 targeted tests plus Biome/source-wiring/diff checks. All changes remained inside `owns`.
- 2026-07-14: Wave 2 / Task_2 completed. Repository lint passed 9/9 package tasks; type-check passed 16/16 tasks plus E2E TypeScript; tests passed 15/15 Turbo tasks plus root environment/container checks; K8s wiring passed 7/7. A production-order deploy closure resolved `@nexus-form/database` to `dist/index.js` and exposed `runMigrations`. Independent Reviewer status: `APPROVED`, no actionable findings.
- 2026-07-14: Wave 3 / Task_3 completed. PR #669 was repeatedly updated from `master` without rebasing, all CI checks including the production image build passed, `gh-review-hook` exited 0 on head `639ab7ae`, GitHub reported `APPROVED` and `CLEAN`, and merge commit `e5a4f3a3` landed on `master`.

## Decision Log (append-only; re-plans and major discoveries)
- 2026-07-13: User expanded the request from diagnosis to full fix, independent review iteration, PR review-hook iteration, and merge. User approval: yes.
- 2026-07-13: Preserve the public package import and repair image layout; remove API-startup migration to match the dedicated Kubernetes Job contract and existing README.
- 2026-07-13: The first local arm64 image build reached dependency installation but an optional native module fell back to source compilation and was killed with exit 137. Retry the same production target as `linux/amd64`, matching the release platform intent, and keep the arm64 failure as environment evidence rather than a passing check.
- 2026-07-13: The amd64 retry could not proceed because the local Docker installation lacks buildx and its legacy multi-stage builder rejected the requested platform. Use the production-order deploy/import probe as runtime-resolution evidence and require remote CI/release image build before merge.
- 2026-07-13: Replace the three fragmented migration COPY instructions with a single `/tmp/db-deploy` closure copy under the database package path. This preserves package self-containment, avoids pnpm store-path hardcoding, and was verified with root and `/schema` ESM imports.
- 2026-07-14: Required-check waiver — local production image build. Both native arm64 and official Buildx amd64 attempts exhausted the 2 GiB Colima VM during dependency installation before any changed Dockerfile stage. Mitigation evidence: production-order `pnpm deploy` closure import probe, source-wiring regression suite in the root test command, full repository checks, and independent Reviewer approval. Residual risk: a full image build will first run in the existing post-merge `master` Docker workflow; owner: Orchestrator; expiry: successful post-merge Docker Build and Push workflow.
- 2026-07-14: The local image-build waiver expired before merge when PR CI `Build (production)` completed successfully on the final reviewed head.

## Notes
- Risks: runtime image layout and deployment sequencing are release-critical; no schema contents change.
- Quality routing: L2. In scope: JavaScript/ESM, Docker runtime artifact layout, migration entrypoint, build/CI-sensitive wiring. Out of scope: frontend, API contract schemas, auth, database DDL semantics.
