# Plan: Telemetry Token Candidate Consumption

- status: done
- generated: 2026-07-04
- last_updated: 2026-07-04
- work_type: code

## Goal
- When public form submission is allowed by any matching telemetry token, consume the other submitted telemetry token candidates too so they cannot be reused.

## Definition of Done
- Submission still requires at least one current-IP token match.
- After a match, remaining submitted unused/unexpired token rows are marked `usedAt` regardless of IP match.
- Focused telemetry tests and required repo checks pass.

## Scope / Non-goals
- Scope:
  - `apps/api/src/lib/telemetry/tokens.ts`
  - `apps/api/src/lib/telemetry/__tests__/tokens.test.ts`
- Non-goals:
  - Changing token issuance.
  - Changing client payload shape.
  - Changing IP extraction strategy.

## Tasks

### Task_1: Consume all submitted candidates after authorization
- type: impl
- owns:
  - apps/api/src/lib/telemetry/tokens.ts
  - apps/api/src/lib/telemetry/__tests__/tokens.test.ts
- depends_on: []
- description: |
  Keep any-match authorization, then mark all remaining submitted unused/unexpired token candidates used.
- acceptance:
  - Zero current-IP matches still rejects.
  - One current-IP match succeeds.
  - After success, a second update consumes remaining submitted candidates without IP filtering.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "rtk pnpm --filter @nexus-form/api exec vitest run src/lib/telemetry/__tests__/tokens.test.ts --silent"

## Task Waves
- Wave 1 (parallel): [Task_1]

## Progress Log
- 2026-07-04 00:00 Wave 1 started: [Task_1]
  - Summary: Update telemetry token consumption to burn remaining submitted candidates after any-match authorization.
  - Validation evidence: pending.
  - Notes: User explicitly requested this follow-up behavior.
- 2026-07-04 00:17 Wave 1 completed: [Task_1]
  - Summary: Added post-authorization candidate consumption and test coverage for the second update without IP filtering.
  - Validation evidence: `rtk pnpm --filter @nexus-form/api exec vitest run src/lib/telemetry/__tests__/tokens.test.ts --silent`; `rtk pnpm lint:fix`; `rtk pnpm type-check`; `rtk pnpm test --silent`.
  - Notes: All validation passed.

## Decision Log
- 2026-07-04 00:00 Decision:
  - Trigger / new insight: Non-matching v4/v6 candidate remains reusable after any-match authorization.
  - Plan delta: Add post-authorization candidate consumption update.
  - Tradeoffs considered: Invalid/random token values still have no matching DB row and are ignored; valid submitted token rows are burned to avoid replay.
  - User approval: yes, direct request.
