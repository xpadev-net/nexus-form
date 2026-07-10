# Codebase Review Remediation Task Ledger

- updated: 2026-07-11
- source: `docs/coding-agent/plans/active/codebase-review-remediation-roadmap-plan.md`
- orchestrator: parent Codex task
- worker runtime: `gpt-5.6-luna` / `high`

## Active Wave

| ID | Task | Status | Branch | Worker | PR | Next action |
|---|---|---|---|---|---|---|
| K8S-1 | Fail-closed API origin validation | ready | `codex/k8s-origin-validation` | — | — | Start worker |
| K8S-3 | Notification Worker Deployment | ready | `codex/k8s-notification-worker` | — | — | Start worker |
| LOG-1 | Central request-target sanitizer | ready | `codex/request-log-sanitizer` | — | — | Start worker |
| PLUGIN-1 | Compatible plugin execution context | ready | `codex/plugin-execution-context` | — | — | Start worker |
| WEBERR-1 | Runtime-validated client error envelope | ready | `codex/web-api-error-envelope` | — | — | Start worker |

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
