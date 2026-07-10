# Codebase Review Remediation Task Ledger

- updated: 2026-07-11
- source: `docs/coding-agent/plans/active/codebase-review-remediation-roadmap-plan.md`
- orchestrator: parent Codex task
- worker runtime: `gpt-5.6-luna` / `high`

## Active Wave

| ID | Task | Status | Branch | Worker | PR | Next action |
|---|---|---|---|---|---|---|
| K8S-1 | Fail-closed API origin validation | in progress | `codex/k8s-origin-validation` | `019f4d76-22ef-7af2-98eb-a5d27613b1a2` | — | Worker implementation |
| K8S-3 | Notification Worker Deployment | in progress | `codex/k8s-notification-worker` | `019f4d76-22ef-7af2-98eb-a610d4774b4e` | — | Worker implementation |
| LOG-1 | Central request-target sanitizer | in progress | `codex/request-log-sanitizer` | `019f4d76-22ef-7af2-98eb-a62260075b68` | — | Worker implementation |
| PLUGIN-1 | Compatible plugin execution context | in progress | `codex/plugin-execution-context` | `019f4d76-22ef-7af2-98eb-a5f274d2fc95` | — | Worker implementation |
| WEBERR-1 | Runtime-validated client error envelope | in progress | `codex/web-api-error-envelope` | `019f4d76-22ef-7af2-98eb-a5b4e45c6e62` | — | Worker implementation |

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

## Follow-up Findings

| ID | Finding | Status | Dependency / next action |
|---|---|---|---|
| AUTH-ORIGIN-1 | Better Auth `trustedOrigins` can retain localhost fallback while shared production origin enforcement fails closed | queued | Verify and remediate after K8S-1; own `apps/api/src/lib/auth.ts`, CSRF/auth-route boundaries, and focused auth-origin tests in a separate PR |

## Lifecycle Log

- 2026-07-11: Initialized from the comprehensive codebase review remediation plans.
- 2026-07-11: Selected five bounded, dependency-free, non-overlapping first-wave tasks.
- 2026-07-11: Started first-wave workers in isolated worktrees with `gpt-5.6-luna` at `high` reasoning.
- 2026-07-11: Startup stability check passed for all five workers; replaced queued client IDs with durable thread IDs.
- 2026-07-11: Recorded K8S-1 out-of-scope Better Auth origin fallback as separate follow-up AUTH-ORIGIN-1. Checked-in Kubernetes config already sets `NODE_ENV=production`; alternative external deployment environment conventions remain outside current scope.
