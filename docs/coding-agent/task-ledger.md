# Codebase Review Remediation Task Ledger

- updated: 2026-07-11
- source: `docs/coding-agent/plans/active/codebase-review-remediation-roadmap-plan.md`
- orchestrator: parent Codex task
- worker runtime: `gpt-5.6-luna` / `high`

## Active Wave

| ID | Task | Status | Branch | Worker | PR | Next action |
|---|---|---|---|---|---|---|
| K8S-1 | Fail-closed API origin validation | in progress | `codex/k8s-origin-validation` | `client-new-thread:af32609b-8377-48e6-a227-8ebd713fc30f` | — | Startup stability check |
| K8S-3 | Notification Worker Deployment | in progress | `codex/k8s-notification-worker` | `client-new-thread:c772f348-979c-4d36-a255-02a29918b6b5` | — | Startup stability check |
| LOG-1 | Central request-target sanitizer | in progress | `codex/request-log-sanitizer` | `client-new-thread:3411f510-75b2-4494-8a1d-39be2fc4dc20` | — | Startup stability check |
| PLUGIN-1 | Compatible plugin execution context | in progress | `codex/plugin-execution-context` | `client-new-thread:28863c9a-74a8-4089-bfdf-edcd9d1f33cd` | — | Startup stability check |
| WEBERR-1 | Runtime-validated client error envelope | in progress | `codex/web-api-error-envelope` | `client-new-thread:ea8ed903-29ae-4449-9f4b-70303116ec15` | — | Startup stability check |

## Queued Plans

| Plan | Status | Dependency / conflict note |
|---|---|---|
| Kubernetes Runtime Wiring Hardening | queued | K8S-2 depends on K8S-1; K8S-4 depends on K8S-2 and K8S-3 |
| Sensitive Request Log Redaction | queued | LOG-2 depends on LOG-1 and overlaps `apps/api/src/index.ts` with K8S-1 |
| External Validation Plugin Timeout | queued | Remaining tasks depend on PLUGIN-1 |
| Web API Error and Discord Auth UX | queued | Remaining tasks depend on WEBERR-1 |
| Public Form Password Verification Revocation | queued | Keep serialized with other `forms-public.ts` work |
| Public Password Request Bounds | queued | Keep serialized with other `forms-public.ts` work |
| Validation Outbox Retry Recovery | queued | Design first; serialize submission-route changes |
| Realtime E2E Auth Fixture | queued | Design first; run after security/reliability slices |

## Lifecycle Log

- 2026-07-11: Initialized from the comprehensive codebase review remediation plans.
- 2026-07-11: Selected five bounded, dependency-free, non-overlapping first-wave tasks.
- 2026-07-11: Started first-wave workers in isolated worktrees with `gpt-5.6-luna` at `high` reasoning.
