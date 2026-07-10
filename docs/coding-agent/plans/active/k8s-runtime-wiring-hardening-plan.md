# Plan: Kubernetes Runtime Wiring Hardening

- status: draft
- generated: 2026-07-11
- last_updated: 2026-07-11
- work_type: code

## Goal
- Make the checked-in Kubernetes deployment fail closed for trusted browser origins and consume every production BullMQ queue.

## Definition of Done
- Production API configuration cannot start with an empty trusted-origin set.
- A deployed Worker consumes `form-submit-notifications`.
- Rendered manifests and runtime selection are regression-tested.

## Scope / Non-goals
- Scope: Kubernetes manifests/docs, API production-origin startup validation, Worker deployment wiring, targeted tests.
- Non-goals: ingress-controller installation, email provider implementation, unrelated queue scaling.

## Context
- Findings: empty `TRUSTED_ORIGINS`; no notification queue consumer.
- Existing patterns: per-queue Worker Deployments and `WORKER_QUEUES` selection.
- Repo rule suite is absent.

## Assumptions
- Production overlays must replace example origins with actual Web origins.
- Notification processing receives a dedicated Deployment rather than coupling it to Sheets.

## Tasks

### Task_1: Enforce fail-closed API origin validation
- type: impl
- owns:
  - apps/api/src/lib/cors-origins.ts
  - apps/api/src/lib/__tests__/cors-origins.test.ts
  - apps/api/src/index.ts
- depends_on: []
- description: Require a normalized, non-empty `TRUSTED_ORIGINS` set in production before the API starts serving.
- acceptance:
  - API startup fails before serving when production trusted origins are empty or invalid.
  - Development/test localhost behavior remains unchanged.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/lib/__tests__/cors-origins.test.ts src/lib/__tests__/csrf-origin-guard.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Verify cookie-bearing same-origin and cross-origin requests are allowed only for configured origins."

### Task_2: Declare trusted origins in Kubernetes templates
- type: chore
- owns:
  - k8s/base/configmap.yaml
  - k8s/overlays/production/configmap-patch.yaml
  - k8s/README.md
- depends_on: [Task_1]
- description: Expose an explicit replace-before-deploy origin value and document same-origin/cross-origin configuration.
- acceptance:
  - Base and production templates provide `TRUSTED_ORIGINS` to the API.
  - README explains multiple origins and the production fail-fast behavior.
  - Example values are visibly placeholders and not silently usable as real production domains.
- validation:
  - kind: inspection
    required: true
    owner: reviewer
    detail: "Inspect rendered ConfigMap values and documentation for safe replacement guidance."

### Task_3: Add the notification Worker Deployment
- type: impl
- owns:
  - k8s/base/bullmq-notifications-deployment.yaml
  - k8s/base/kustomization.yaml
  - k8s/overlays/production/kustomization.yaml
  - apps/worker/src/lib/__tests__/worker-queue-selection.test.ts
- depends_on: []
- description: Deploy a health-probed Worker selecting `form-submit-notifications` and keep image/env/resource conventions aligned with existing workers.
- acceptance:
  - Rendered base and production manifests include exactly one notification consumer Deployment.
  - `WORKER_QUEUES` uses the shared queue name and unknown values still fail startup.
  - Probe paths and Worker health-file settings match existing production Worker conventions.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/lib/__tests__/worker-queue-selection.test.ts"
  - kind: command
    required: true
    owner: reviewer
    detail: "kubectl kustomize k8s/base && kubectl kustomize k8s/overlays/production"

### Task_4: Add deployment wiring regression coverage
- type: test
- owns:
  - scripts/check-k8s-runtime-wiring.mjs
  - scripts/check-k8s-runtime-wiring.test.mjs
  - package.json
- depends_on: [Task_2, Task_3]
- description: Add a deterministic manifest check for required API env keys and queue-consumer coverage.
- acceptance:
  - Test fails when `TRUSTED_ORIGINS` disappears.
  - Test fails when a produced first-party queue has no Kubernetes consumer.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run the new Kubernetes manifest parity test from the repository root."

### Task_5: Final review and repository validation
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
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent deployment/security review of rendered manifests and startup behavior."

## Task Waves
- Wave 1 (parallel): [Task_1, Task_3]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_4]
- Wave 4 (parallel): [Task_5]

## Rollback / Safety
- Roll back the new Deployment independently; do not relax production origin validation during rollback.

## Progress Log
- 2026-07-11: Draft created; no implementation started.

## Decision Log
- 2026-07-11: Grouped both findings because they are Kubernetes runtime wiring defects sharing manifest rendering and deployment validation.
