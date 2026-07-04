# Plan: Telemetry Token Investigation

- status: done
- generated: 2026-07-05
- last_updated: 2026-07-05
- work_type: research

## Goal
- Identify why form submission returns `Invalid or expired telemetry tokens` after a form load creates v4/v6 telemetry tokens and submission sets `usedAt` on the v6 token.

## Definition of Done
- Token creation, client submission, server validation, and `usedAt` update paths are traced.
- The most likely root cause is stated with file references and supporting evidence.
- No app code is changed unless a separate fix is requested.

## Scope / Non-goals
- Scope:
  - Telemetry token lifecycle in API/web/shared/database code.
  - Existing tests or command-level evidence relevant to telemetry validation.
- Non-goals:
  - Implementing a fix.
  - Changing schemas, migrations, or UI behavior.

## Context (workspace)
- Related files/areas:
  - `apps/api/**`
  - `apps/web/**`
  - `packages/database/**`
  - `packages/shared/**`
- Existing patterns or references:
  - Hono RPC typed client and zod contracts.
- Repo reference docs consulted:
  - `AGENTS.md`
  - `CLAUDE.md`
  - `docs/coding-agent/rules/index.md` absent

## Open Questions
- Q1: none currently.

## Assumptions
- A1: The observed sequence is accurate: form load creates both v4/v6 tokens, submit marks the v6 token `usedAt`, then the API returns the invalid/expired token error.
- A2: Investigation-only work can proceed without user approval because the user explicitly asked for cause analysis and no app code changes are planned.

## Tasks

### Task_1: Trace telemetry token lifecycle
- type: research
- owns:
  - apps/api/**
  - apps/web/**
  - packages/database/**
  - packages/shared/**
- depends_on: []
- description: |
  Trace telemetry token creation, client payload shape, server validation, and token consumption.
- acceptance:
  - Creation route and token variants are identified.
  - Submission route and validation logic are identified.
  - `usedAt` write timing is identified.
  - Candidate mismatch or race is documented.
- validation:
  - kind: review
    required: true
    owner: orchestrator
    detail: "File references and code evidence support the stated cause."

## Task Waves
- Wave 1 (parallel): [Task_1]

## Rollback / Safety
- Investigation only. Remove or move this plan when complete.

## Progress Log
- 2026-07-05 00:00 Wave 1 started: [Task_1]
  - Summary: Begin targeted telemetry-token trace.
  - Validation evidence: pending.
  - Notes: Research approval waived for investigation-only request with no app code edits.
- 2026-07-05 00:06 Wave 1 completed: [Task_1]
  - Summary: Root cause identified as partial token consumption followed by affected-row mismatch when v4/v6 tokens do not both satisfy submit-time IP/unused/expiry conditions.
  - Validation evidence: `rtk pnpm --filter @nexus-form/api exec vitest run src/lib/telemetry/__tests__/tokens.test.ts src/routes/telemetry.test.ts src/__tests__/forms-public-validation-outbox.test.ts --silent`; `rtk pnpm --filter @nexus-form/web exec vitest run src/lib/telemetry-token.test.ts src/components/forms/public-form-page.test.tsx --silent`.
  - Notes: Both targeted command sets passed.

## Decision Log
- 2026-07-05 00:00 Decision:
  - Trigger / new insight: User requested cause investigation, not implementation.
  - Plan delta: Single research task; no Worker dispatch.
  - Tradeoffs considered: Subagent dispatch would add overhead without improving a narrow read-only trace.
  - User approval: waived.

## Notes
- Risks:
  - Runtime behavior may depend on DB state or concurrent requests; code trace may need command/test confirmation.
