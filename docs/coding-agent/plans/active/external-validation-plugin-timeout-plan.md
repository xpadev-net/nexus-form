# Plan: External Validation Plugin Timeout

- status: draft
- generated: 2026-07-11
- last_updated: 2026-07-11
- work_type: code

## Goal
- Enforce a host-owned execution deadline and shutdown cancellation boundary for every validation plugin.

## Definition of Done
- A hung or signal-ignoring external plugin cannot retain a BullMQ concurrency slot indefinitely.
- Cooperative plugins receive an `AbortSignal` without breaking existing two-argument plugins.
- Timeout/shutdown results reach a deterministic terminal or retryable state.

## Scope / Non-goals
- Scope: plugin interface, Worker host execution wrapper, built-in providers where signal propagation is practical, tests/docs.
- Non-goals: sandboxing untrusted JavaScript or terminating arbitrary CPU-bound synchronous plugin code.

## Context
- Existing built-in HTTP clients have individual timeouts, but the host directly awaits `validate()`.
- External `.mjs` plugins are a supported extension boundary.

## Tasks

### Task_1: Extend the plugin execution contract compatibly
- type: design
- owns:
  - packages/integrations/src/plugin-interface.ts
  - docs/external-plugins.md
- depends_on: []
- description: Define an optional execution context containing `AbortSignal` and deadline metadata while preserving existing plugin call compatibility.
- acceptance:
  - Existing plugins accepting `(input, config)` continue to load.
  - New plugins can observe cancellation and remaining deadline.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Review external plugin API compatibility and cancellation semantics."

### Task_2: Add bounded Worker timeout configuration
- type: impl
- owns:
  - apps/worker/src/lib/env.ts
  - apps/worker/src/lib/__tests__/env.test.ts
- depends_on: [Task_1]
- description: Parse and clamp the validation plugin deadline from environment/defaults independently of execution behavior.
- acceptance:
  - Timeout configuration is bounded and validated from environment/defaults.
  - Invalid, zero, negative, and excessive values resolve to documented safe behavior.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run focused Worker environment parsing tests."

### Task_3: Add the host-enforced deadline wrapper
- type: impl
- owns:
  - apps/worker/src/handlers/generic-validation.ts
  - apps/worker/src/lib/shutdown-signal.ts
- depends_on: [Task_1, Task_2]
- description: Race provider execution against the bounded deadline, abort cooperatively, consume late rejection safely, and integrate Worker shutdown.
- acceptance:
  - Never-settling async validation releases the job handler at the deadline.
  - Worker shutdown aborts the same execution context.
  - Late rejection cannot become unhandled or overwrite a terminal result.
  - Timeout error code and retry policy are explicit.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run existing generic-validation and shutdown tests."

### Task_4: Propagate cancellation through Discord validation
- type: impl
- owns:
  - packages/validation-provider-discord/src/plugin.ts
  - packages/validation-provider-discord/src/requests.ts
  - packages/validation-provider-discord/src/__tests__/plugin.test.ts
- depends_on: [Task_1, Task_3]
- description: Accept the optional execution context and pass its signal through Discord HTTP operations.
- acceptance:
  - Discord requests stop on host abort without changing provider-specific timeout/error mapping.
  - Existing validation behavior remains compatible when no context is supplied.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/validation-provider-discord test"

### Task_5: Propagate cancellation through GitHub validation
- type: impl
- owns:
  - packages/validation-provider-github/src/plugin.ts
  - packages/validation-provider-github/src/client.ts
  - packages/validation-provider-github/src/__tests__/plugin.test.ts
- depends_on: [Task_1, Task_3]
- description: Accept the optional execution context and pass its signal through GitHub HTTP operations.
- acceptance:
  - GitHub requests stop on host abort without changing Octokit error mapping.
  - Existing validation behavior remains compatible when no context is supplied.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/validation-provider-github test"

### Task_6: Propagate cancellation through Twitter validation
- type: impl
- owns:
  - packages/validation-provider-twitter/src/plugin.ts
  - packages/validation-provider-twitter/src/client.ts
  - packages/validation-provider-twitter/src/__tests__/plugin.test.ts
- depends_on: [Task_1, Task_3]
- description: Accept the optional execution context and pass its signal through Twitter HTTP operations.
- acceptance:
  - Twitter requests stop on host abort without changing Axios error mapping.
  - Existing validation behavior remains compatible when no context is supplied.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/validation-provider-twitter test"

### Task_7: Add host deadline and shutdown tests
- type: test
- owns:
  - apps/worker/src/handlers/__tests__/generic-validation.test.ts
- depends_on: [Task_3]
- acceptance:
  - Tests cover never-resolving plugin, ignored signal, cooperative abort, shutdown, and late rejection.
  - Tests assert state/error semantics, not execution duration.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/generic-validation.test.ts"

### Task_8: Add plugin-interface compatibility tests
- type: test
- owns:
  - packages/integrations/src/__tests__/plugin-interface.test.ts
  - packages/integrations/src/__tests__/plugin-loader.test.ts
- depends_on: [Task_1]
- acceptance:
  - Tests cover legacy two-argument plugins and new context-aware plugins.
  - Loader validation remains compatible with existing external `.mjs` artifacts.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/integrations test"

### Task_9: Final validation and review
- type: review
- owns: []
- depends_on: [Task_4, Task_5, Task_6, Task_7, Task_8]
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
    detail: "Independent resource-lifecycle and external-contract review."

## Task Waves
- Wave 1: [Task_1]
- Wave 2: [Task_2]
- Wave 3: [Task_3]
- Wave 4 (parallel): [Task_4, Task_5, Task_6, Task_7, Task_8]
- Wave 5: [Task_9]

## Rollback / Safety
- Keep plugin context optional during rollout; host deadline remains mandatory even if a plugin ignores cancellation.

## Progress Log
- 2026-07-11: Draft created.

## Decision Log
- 2026-07-11: Host deadline plus optional signal chosen because signal-only contracts cannot contain non-cooperative plugins.
