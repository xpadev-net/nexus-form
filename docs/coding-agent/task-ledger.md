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
| K8S-2 | Trusted origins in Kubernetes templates | complete | `codex/k8s-trusted-origins-config` | `019f4e46-668a-7041-9e8e-b2660a938e75` | [#651](https://github.com/xpadev-net/nexus-form/pull/651) | Merged as `c92bd424237d97b3a1fc599f4288f7b967ad3f23`; archive worker |
| LOG-2 | Sanitizer-aware request logger middleware | in progress | `codex/request-log-middleware` | `019f4e46-6692-7841-a62a-16799ecfd26a` | — | Worker implementation |
| PLUGIN-2 | Bounded Worker plugin timeout configuration | complete | `codex/plugin-timeout-env` | `019f4e46-668d-71f3-807a-4c772ba1e7b9` | [#652](https://github.com/xpadev-net/nexus-form/pull/652) | Merged as `4efefec59924bf308f4fcbb7026ea72c9d279ba6`; archive worker |
| WEBERR-2 | Discord sign-in pending and error state | complete | `codex/discord-signin-state` | `019f4e46-6688-7d92-8e32-4fe6ed7acda5` | [#654](https://github.com/xpadev-net/nexus-form/pull/654) | Merged as `e4ee10ffe037e2728d5c8c300d369d93f600b35e`; archive worker |
| AUTH-ORIGIN-1 | Better Auth trusted-origin boundary | complete | `codex/better-auth-origin-boundary` | `019f4e46-668a-7041-9e8e-b285de656272` | [#655](https://github.com/xpadev-net/nexus-form/pull/655) | Merged as `f05b18dbaf32429c80474002a34e0306ece59bb3`; archive worker |
| K8S-4 | Deployment wiring regression coverage | in progress | `codex/k8s-runtime-wiring-check` | `client-new-thread:b038c559-fc3f-4e1f-a2c1-5111ec52e4c4` | — | Worker implementation |
| PLUGIN-3 | Host-enforced plugin deadline wrapper | in progress | `codex/plugin-host-deadline` | `client-new-thread:05b32b9e-8039-4b99-b6a8-6e0e40fc5d89` | — | Worker implementation |

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
| AUTH-ORIGIN-1 | Better Auth `trustedOrigins` can retain localhost fallback while shared production origin enforcement fails closed | complete | Resolved in PR #655 with shared normalization, production fail-closed construction, and an auth-boundary guard |

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
- 2026-07-11: Started second-wave workers for K8S-2, LOG-2, PLUGIN-2, WEBERR-2, and AUTH-ORIGIN-1 in isolated worktrees with `gpt-5.6-luna` at `high` reasoning. Ownership is non-overlapping across Kubernetes, API logger wiring, Worker env, Web auth UX, and API auth-origin boundaries.
- 2026-07-11: Second-wave startup stability check passed for all five workers; replaced queued client IDs with durable thread IDs.
- 2026-07-11: K8S-2 merged via PR #651 (`c92bd424237d97b3a1fc599f4288f7b967ad3f23`). Parent review found and worker fixed production-overlay edit ambiguity and missing ConfigMap-to-Pod rollout/revert instructions; worker and orchestrator hooks exited 0; CI passed; parent base/production renders and 26 focused API tests passed; final independent parent review found no actionable issues. Residual risk: live-cluster apply and rollout remain unverified.
- 2026-07-11: WEBERR-2 merged via PR #654 (`e4ee10ffe037e2728d5c8c300d369d93f600b35e`). Parent review found and worker fixed nested live-region duplication; worker and orchestrator hooks exited 0; CI passed; parent focused Web tests passed 8 tests and Web type-check passed; final independent parent review found no actionable issues. Residual risk: component-level pending/error/retry/a11y regression tests remain reserved for WEBERR-3.
- 2026-07-11: PLUGIN-2 merged via PR #652 (`4efefec59924bf308f4fcbb7026ea72c9d279ba6`). Task_2 remained a bounded environment-parsing slice, with Task_3 host execution wiring explicitly deferred per the active plan; worker and orchestrator hooks exited 0; CI passed; parent focused Worker env tests passed 11 tests and Worker type-check passed; final independent parent review found no actionable issues. Residual risk: runtime enforcement remains intentionally pending in Task_3.
- 2026-07-11: AUTH-ORIGIN-1 merged via PR #655 (`f05b18dbaf32429c80474002a34e0306ece59bb3`). Parent review required and worker added the trusted normalized Origin allow-path regression after independent security review found no remaining boundary bypass; worker and orchestrator hooks exited 0; CI passed; parent focused auth/origin/CSRF tests passed 38 tests and API type-check passed; final independent parent security review found no actionable issues. Residual risk: a future OAuth provider using `response_mode=form_post` with `SameSite=None` requires a dedicated callback design review.
- 2026-07-11: Started dependency-ready K8S-4 and PLUGIN-3 workers in isolated worktrees with `gpt-5.6-luna` at `high` reasoning. Ownership is disjoint across root manifest-check scripts/package metadata and Worker host deadline lifecycle code; LOG-2 remains active separately.
