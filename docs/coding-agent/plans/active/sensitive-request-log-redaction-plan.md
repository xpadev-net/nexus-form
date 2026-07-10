# Plan: Sensitive Request Log Redaction

- status: draft
- generated: 2026-07-11
- last_updated: 2026-07-11
- work_type: code

## Goal
- Prevent invite, share-link, OAuth, and SSE credentials from appearing in request logs while preserving useful route diagnostics.

## Definition of Done
- Sensitive query parameters and credential-bearing path segments are redacted before logging.
- Request/response log correlation, method, status, and safe route context remain available.
- Regression tests prove raw secrets never reach the logging sink.

## Scope / Non-goals
- Scope: API request logger wrapper/sanitizer and tests.
- Non-goals: application payload logger redesign, third-party infrastructure log retention policy.

## Tasks

### Task_1: Implement a centralized request-target sanitizer
- type: impl
- owns:
  - apps/api/src/lib/logger/**
  - apps/api/src/lib/request-logging.ts
- depends_on: []
- description: Normalize logged URLs, remove query values, and redact tokens in known credential-bearing route segments.
- acceptance:
  - `code`, `state`, `shareToken`, invite token, and shared-link token values are never returned.
  - Malformed URLs fail closed to a safe placeholder.
  - Non-sensitive route paths remain diagnosable.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "Run focused unit tests for request-target sanitization."

### Task_2: Replace the raw Hono logger
- type: impl
- owns:
  - apps/api/src/index.ts
  - apps/api/src/lib/request-logging.ts
- depends_on: [Task_1]
- description: Wire a sanitizer-aware middleware for both incoming and outgoing request logs.
- acceptance:
  - Both request-start and response-completion logs use the sanitized target.
  - Existing error logging and status/timing output continue to work.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Trace every API request log sink and confirm none bypasses sanitization."

### Task_3: Add secret non-disclosure integration tests
- type: test
- owns:
  - apps/api/src/__tests__/request-logging.test.ts
  - apps/api/src/__tests__/routes.test.ts
- depends_on: [Task_2]
- acceptance:
  - Tests exercise invite, shared-link, OAuth callback, and SSE share-token URLs.
  - Assertions check absence of exact secret values and presence of safe route context.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/request-logging.test.ts"

### Task_4: Final validation and review
- type: review
- owns: []
- depends_on: [Task_3]
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
    detail: "Independent secret/PII logging review."

## Task Waves
- Wave 1: [Task_1]
- Wave 2: [Task_2]
- Wave 3: [Task_3]
- Wave 4: [Task_4]

## Rollback / Safety
- Do not restore raw URL logging during rollback; fall back to method plus redacted path.

## Progress Log
- 2026-07-11: Draft created.

## Decision Log
- 2026-07-11: Central sanitizer selected over route-local fixes so future credential routes inherit safe logging.

