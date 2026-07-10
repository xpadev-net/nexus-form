# Codebase Review Remediation Task Ledger

- updated: 2026-07-11
- source: `docs/coding-agent/plans/active/codebase-review-remediation-roadmap-plan.md`
- orchestrator: parent Codex task
- worker runtime: `gpt-5.6-luna` / `high`

## Active Wave

| ID | Task | Status | Branch | Worker | PR | Next action |
|---|---|---|---|---|---|---|
| K8S-1 | Fail-closed API origin validation | complete | `codex/k8s-origin-validation` | `019f4d76-22ef-7af2-98eb-a5d27613b1a2` | [#648](https://github.com/xpadev-net/nexus-form/pull/648) | Merged as `c068fb6d235e829afaf0950f500181cb619af478`; archive worker |
| K8S-3 | Notification Worker Deployment | complete | `codex/k8s-notification-worker` | `019f4d76-22ef-7af2-98eb-a610d4774b4e` | [#646](https://github.com/xpadev-net/nexus-form/pull/646) | Merged as `aa4b05912af95de640c2896cc06ab282a26fd150`; archive worker |
| LOG-1 | Central request-target sanitizer | complete | `codex/request-log-sanitizer` | `019f4d76-22ef-7af2-98eb-a62260075b68` | [#649](https://github.com/xpadev-net/nexus-form/pull/649) | Merged as `52c7085066ce3dd44f73bd5d34ba4872849ab638`; archive worker |
| PLUGIN-1 | Compatible plugin execution context | complete | `codex/plugin-execution-context` | `019f4d76-22ef-7af2-98eb-a5f274d2fc95` | [#650](https://github.com/xpadev-net/nexus-form/pull/650) | Merged as `16a90c4496a465e5f5efc4446810d85b44fb45d7`; archive worker |
| WEBERR-1 | Runtime-validated client error envelope | complete | `codex/web-api-error-envelope` | `019f4d76-22ef-7af2-98eb-a5b4e45c6e62` | [#647](https://github.com/xpadev-net/nexus-form/pull/647) | Merged as `f1f9442b2e020d72e1de6931c5f8522182b41ef2`; archive worker |

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
- 2026-07-11: K8S-3 merged via PR #646 (`aa4b05912af95de640c2896cc06ab282a26fd150`). Worker and orchestrator `gh-review-hook` exited 0; CI passed; focused Worker test passed 9 tests; base/production manifests rendered with exactly one notification consumer; two independent orchestrator review passes found no actionable issues. Residual risk: live-cluster Pod/probe validation remains unperformed and manifest parity automation is deferred to K8S-4.
- 2026-07-11: Expanded PLUGIN-1 within `packages/integrations` to include `src/index.ts` and a minimal root-export regression test. Independent review found the new public execution-context type was otherwise unavailable to external TypeScript plugins; deferring would leave the contract incomplete.
- 2026-07-11: PLUGIN-1 merged via PR #650 (`16a90c4496a465e5f5efc4446810d85b44fb45d7`). Worker and orchestrator `gh-review-hook` exited 0; CI passed; focused integrations suite passed 78 tests; two orchestrator review passes found no actionable issues. Residual risk: Worker propagation and host-enforced deadlines remain intentionally queued in later plugin-timeout tasks.
- 2026-07-11: WEBERR-1 merged via PR #647 (`f1f9442b2e020d72e1de6931c5f8522182b41ef2`). Parent review found and worker fixed malformed-envelope diagnostic loss; worker and orchestrator hooks exited 0; CI passed; parent focused Web tests passed 5 tests; final independent parent review found no actionable issues. Residual risks: success-body runtime validation and whitespace-only messages remain outside this error-only slice.
- 2026-07-11: K8S-1 merged via PR #648 (`c068fb6d235e829afaf0950f500181cb619af478`). Parent review found and worker fixed wildcard-origin acceptance and added import-based serving regression coverage; worker and orchestrator hooks exited 0; CI passed; parent focused API tests passed 26 tests; final parent review found no actionable issues. AUTH-ORIGIN-1 remains queued separately.
- 2026-07-11: LOG-1 merged via PR #649 (`52c7085066ce3dd44f73bd5d34ba4872849ab638`). Parent reviews found and worker fixed multi-encoded marker and path-parameter redaction bypasses; worker and orchestrator hooks exited 0; CI passed after an unrelated E2E flake rerun; parent focused sanitizer tests passed 28 tests; final parent review found no actionable issues. Logger wiring remains queued as LOG-2.
