# Plan: Telemetry Token Any-Match Fix

- status: done
- generated: 2026-07-05
- last_updated: 2026-07-05
- work_type: code

## Goal
- Allow public form submission when at least one submitted telemetry token matches the submit-time client IP, is unused, and is unexpired.

## Definition of Done
- `consumeTokensOrThrow` succeeds when one of multiple unique tokens is valid for the current IP.
- Submissions are still rejected when no submitted token matches.
- Targeted API tests pass.

## Scope / Non-goals
- Scope:
  - `apps/api/src/lib/telemetry/tokens.ts`
  - Telemetry/public submit tests.
  - Repo-local correction lesson.
- Non-goals:
  - Changing telemetry host resolution.
  - Changing proxy/IP extraction strategy.

## Context (workspace)
- Related files/areas:
  - `apps/api/src/lib/telemetry/tokens.ts`
  - `apps/api/src/lib/telemetry/__tests__/tokens.test.ts`
  - `apps/api/src/__tests__/forms-public-validation-outbox.test.ts`
- Repo reference docs consulted:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `docs/coding-agent/rules/index.md` absent

## Open Questions
- Q1: none.

## Assumptions
- A1: A telemetry token payload represents alternative address-family evidence; any one valid token is sufficient.
- A2: Matching tokens should still be consumed on success to prevent replay.

## Tasks

### Task_1: Update token consumption semantics
- type: impl
- owns:
  - apps/api/src/lib/telemetry/tokens.ts
  - apps/api/src/lib/telemetry/__tests__/tokens.test.ts
  - apps/api/src/__tests__/forms-public-validation-outbox.test.ts
- depends_on: []
- description: |
  Change telemetry token consumption from all submitted tokens must match to at least one submitted token must match.
- acceptance:
  - Multiple unique tokens with one matching affected row succeed.
  - Zero affected rows still rejects.
  - Tests document v4/v6 any-match behavior.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "rtk pnpm --filter @nexus-form/api exec vitest run src/lib/telemetry/__tests__/tokens.test.ts src/__tests__/forms-public-validation-outbox.test.ts --silent"

### Task_2: Record correction lesson
- type: docs
- owns:
  - docs/coding-agent/lessons.md
- depends_on: []
- description: |
  Record the correction so future investigations distinguish all-of vs any-of token semantics.
- acceptance:
  - Lesson includes symptom, root cause, fix, prevention, and tags.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "Lesson entry is scoped to the correction and avoids app behavior claims beyond this task."

## Task Waves
- Wave 1 (parallel): [Task_1, Task_2]

## Rollback / Safety
- Revert the token consumption predicate and associated tests if any-match behavior is rejected.

## Progress Log
- 2026-07-05 00:00 Wave 1 started: [Task_1, Task_2]
  - Summary: Implement any-match telemetry token acceptance and correction lesson.
  - Validation evidence: pending.
  - Notes: User explicitly requested the behavior change, so approval is implicit for this fix.
- 2026-07-05 00:13 Wave 1 completed: [Task_1, Task_2]
  - Summary: `consumeTokensOrThrow` now accepts at least one valid matching token; tests cover one-of-many and all-matching cases.
  - Validation evidence: `rtk pnpm --filter @nexus-form/api exec vitest run src/lib/telemetry/__tests__/tokens.test.ts src/__tests__/forms-public-validation-outbox.test.ts --silent`; `rtk pnpm lint:fix`; `rtk pnpm type-check`; `rtk pnpm test --silent`.
  - Notes: All validation passed.

## Decision Log
- 2026-07-05 00:00 Decision:
  - Trigger / new insight: HTTP submit has one observed client IP, while v4/v6 tokens are alternative network-path evidence.
  - Plan delta: Accept if any submitted token matches instead of requiring all tokens to match.
  - Tradeoffs considered: Leaves non-matching extra token unused, but avoids false rejection for dual telemetry collection.
  - User approval: yes, direct request.
- 2026-07-05 00:13 Decision:
  - Trigger / new insight: Fix is a narrow backend predicate change with focused tests and full repo validation.
  - Plan delta: Independent Reviewer dispatch waived.
  - Tradeoffs considered: Full subagent review would add overhead without materially improving confidence for this scoped change.
  - User approval: waived by Orchestrator.

## Notes
- Risks:
  - If clients can submit unrelated stale tokens alongside one valid token, those unrelated tokens are ignored; this matches the requested any-match semantics.
