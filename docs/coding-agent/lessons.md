# Coding Agent Lessons

## 2026-07-11: Inventory dependency-owned credential routes before wiring access logs

- tags: logging, security, authentication, dependencies
- symptom: Sanitized request middleware still exposed Better Auth password-reset bearer tokens embedded in `/reset-password/:token` paths.
- root cause: The credential-segment inventory covered application routes and OAuth callbacks but did not inspect all path-token endpoints contributed by the mounted authentication dependency.
- fix: Add the dependency's reset-password predecessor to the central redaction set and test request-start, completion, encoded path, and error-target paths.
- prevention: Before enabling centralized request logging, enumerate credential-bearing routes from both first-party handlers and mounted dependency route tables, then pin each path-token shape with a regression test.

## 2026-07-11: Synchronize async tests on observable lifecycle events

- tags: testing, concurrency, cancellation, vitest
- symptom: Fixed-count microtask flushing made deadline and late-rejection tests depend on the implementation's internal `await` depth and allowed callbacks to remain silently uninitialized.
- root cause: Tests advanced timers or invoked optional callbacks after guessing that execution had started instead of observing the provider or lock boundary directly.
- fix: Use deferred signals resolved when validation or lock acquisition begins, assert callback initialization, and then advance fake timers or trigger late settlement.
- prevention: Concurrency tests should synchronize on an explicit observable event, never on a fixed number of microtask turns.

## 2026-07-11: Re-check cancellation after a cooperative operation fulfills

- tags: worker, shutdown, cancellation, state-integrity
- symptom: A plugin could resolve a fallback result from its abort handler before a delayed host shutdown rejection, allowing normal result persistence after shutdown.
- root cause: The wrapper preserved provider rejection causes but treated every fulfilled race outcome as valid without re-reading the authoritative shutdown signal.
- fix: Prefer rejected provider outcomes, then reject fulfilled outcomes when shutdown is already active so existing retry/final-shutdown handling remains authoritative.
- prevention: After racing work against cancellation, validate cancellation state again before accepting any fulfilled result that can cause durable side effects.

## 2026-07-11: Decode rendered scalar values before checking emptiness

- tags: kubernetes, yaml, validation, fail-closed
- symptom: A manifest parity check treated `TRUSTED_ORIGINS: ""` and `TRUSTED_ORIGINS: ''` as non-empty because it tested the raw quoted text.
- root cause: The checker parsed a narrow YAML shape but applied string truthiness before decoding the scalar representation used by Kubernetes.
- fix: Remove matching scalar quote wrappers before trimming and add mutation regressions for missing, double-quoted empty, and single-quoted empty values.
- prevention: Boundary checks over serialized configuration must validate decoded values, and their negative matrix must include both missing keys and explicitly encoded empty values.

## 2026-07-11: Test both rejection and normalized allow paths at security boundaries

- tags: security, csrf, authentication, testing
- symptom: Auth-origin tests covered missing, malformed, and untrusted requests but could still pass if every Cookie-bearing Origin request was rejected.
- root cause: The regression matrix emphasized fail-closed behavior without proving that a valid, non-canonical trusted Origin remained usable after normalization.
- fix: Add an integration case with a non-empty Cookie and uppercase/default-port/trailing-slash trusted Origin, asserting the state-changing request succeeds.
- prevention: Every allowlist boundary must pair rejection cases with at least one normalized positive-path assertion through the real handler.

## 2026-07-11: Explain dependency boundaries when a configuration lands before its consumer

- tags: planning, pull-request, configuration, review
- symptom: Automated review treated a bounded environment-parsing task as incomplete because its dependent execution wiring was intentionally absent.
- root cause: The PR initially described the new configuration without making the active plan's Task_2/Task_3 ownership and dependency boundary explicit enough for standalone review.
- fix: Document the current task's acceptance criteria, owned files, dependent task, and why activating the setting in the same PR would cross scope.
- prevention: When landing a producer contract before its consumer, put the dependency boundary and non-activation rationale in the PR description before requesting review.

## 2026-07-11: Keep each dynamic message on one live-region path

- tags: accessibility, react, authentication, review
- symptom: A sign-in error used `role="alert"` inside a parent `aria-live="polite"`, allowing assistive technology to announce the same message twice or with conflicting priorities.
- root cause: Pending-state and error-state announcements were reviewed individually without tracing the final nested accessibility tree.
- fix: Remove the parent live region and keep the error's `role="alert"` as the single notification source.
- prevention: For dynamic UI messages, inspect ancestor and descendant live regions together and require exactly one intended announcement path per state transition.

## 2026-07-11: Document both configuration precedence and runtime reload behavior

- tags: kubernetes, configuration, rollout, documentation
- symptom: A deployment guide added a required ConfigMap key but did not clearly identify the production overlay as the effective edit point or explain that existing Pods retain the old `envFrom` value.
- root cause: The review treated rendered configuration and runtime adoption as one step, overlooking Kustomize override precedence and the absence of a Pod-template checksum or reloader.
- fix: Name the effective production patch explicitly and document apply, Deployment restart, rollout status, and the same procedure for reverting a value.
- prevention: For every environment-backed Kubernetes setting, verify the final rendered source of truth and how running workloads receive changes and rollbacks.

## 2026-07-11 — Canonicalize Security Markers at the Same Depth as Validation  [tags: review, logging, encoding, secrets]

Context:
- Plan: `docs/coding-agent/plans/active/sensitive-request-log-redaction-plan.md`
- Task/Wave: LOG-1 parent merge review
- Roles involved: Worker, Reviewer, Orchestrator

Symptom:
- Ambiguity checks repeatedly decoded path segments, but credential-marker matching decoded only once.
- A multi-encoded marker could therefore pass validation while avoiding redaction and exposing the following token.

Root cause:
- Validation and security classification used different canonical representations of the same untrusted path segment.

Fix applied:
- Fail closed when a path segment requires a second decoding pass, while preserving single-encoded marker redaction and testing relative and absolute targets.

Prevention:
- Repo rule candidate:
  - audience: worker
  - proposed rule: "Security validation and classification must consume the same canonical representation and encoding depth for untrusted identifiers."
- Dispatch/plan guardrail:
  - Secret-redaction reviews must test single and multiple encoding of both delimiters and the marker names that trigger redaction.
- Residual risk / waiver:
  - Marker allowlists must be updated when new credential-bearing path routes are introduced.

Evidence:
- Parent findings and fixes on PR #649; focused sanitizer suite passes 28 tests including relative and absolute multi-encoding cases.

## 2026-07-11 — Test Configuration Authority and Every Startup Entry Path  [tags: review, security, configuration, startup]

Context:
- Plan: `docs/coding-agent/plans/active/k8s-runtime-wiring-hardening-plan.md`
- Task/Wave: K8S-1 parent merge review
- Roles involved: Worker, Reviewer, Orchestrator

Symptom:
- URL parsing accepted a wildcard hostname that the downstream CORS middleware treats as a literal origin, allowing production startup with unusable configuration.
- Helper tests proved validation logic but did not initially prove that import-based serving adapters executed the fail-closed assertion.

Root cause:
- Syntactic URL validity was treated as equivalent to valid application configuration.
- Tests covered the helper contract without covering every production entry path that must invoke it.

Fix applied:
- Reject wildcard hostnames explicitly and add an isolated child-process test proving invalid production configuration fails during `index.ts` module import.

Prevention:
- Repo rule candidate:
  - audience: worker
  - proposed rule: "For security-sensitive environment configuration, validate downstream semantics beyond parser acceptance and test each supported startup/import entry path."
- Dispatch/plan guardrail:
  - Configuration hardening tests must include special authority syntax and a wiring test that fails if validation is moved behind only one entrypoint.
- Residual risk / waiver:
  - Alternative external production environment conventions and Better Auth origin handling remain separate tracked scope.

Evidence:
- Parent findings and fixes on PR #648; wildcard and import-based serving regressions pass in the focused suite.

## 2026-07-11 — Preserve Diagnostic Details Independently of Envelope Validity  [tags: review, api-errors, compatibility, runtime-validation]

Context:
- Plan: `docs/coding-agent/plans/active/web-api-error-and-discord-auth-ux-plan.md`
- Task/Wave: WEBERR-1 parent merge review
- Roles involved: Worker, Reviewer, Orchestrator

Symptom:
- Runtime validation correctly rejected a malformed nested error message, but coupled that failure to clearing the entire `RpcError.details` record.
- Existing callers could no longer inspect otherwise usable fields such as `details.error.code` and `requestId`.

Root cause:
- Message/code envelope validity and preservation of the top-level diagnostic object were treated as one all-or-nothing contract, despite the previous implementation preserving every non-array JSON object.

Fix applied:
- Parse the top-level record independently from the typed message/code envelope; invalid envelope fields fall back safely while the diagnostic record remains available.

Prevention:
- Repo rule candidate:
  - audience: worker
  - proposed rule: "When tightening runtime validation, audit and preserve independently consumed diagnostic fields instead of discarding the full payload on one invalid field."
- Dispatch/plan guardrail:
  - Boundary-parser reviews must trace existing consumers of both normalized fields and retained raw/details payloads, and add a malformed-partial-envelope compatibility test.
- Residual risk / waiver:
  - none

Evidence:
- Parent deep-review finding on PR #647; regression covers malformed `error.message` while retaining `details.error.code` and `requestId`.

## 2026-07-11 — Write Orchestrator State Directly to Default Branch  [tags: orchestration, git-workflow, ledger, planning]

Context:
- Plan: `docs/coding-agent/plans/active/codebase-review-remediation-roadmap-plan.md`
- Task/Wave: orchestrator bootstrap and ledger persistence
- Roles involved: Orchestrator

Symptom:
- The orchestrator opened PR #645 for plan and task-ledger changes, adding an unnecessary review and CI gate before the remote task state became available on the default branch.

Root cause:
- Applied the implementation-worker PR workflow to orchestrator-owned coordination artifacts instead of distinguishing product-code delivery from plan/ledger state management.

Fix applied:
- Close the orchestrator-only PR and publish its plan, lesson, and ledger commits directly to `master`.

Prevention:
- Repo rule candidate:
  - audience: orchestrator
  - proposed rule: "Write orchestrator-owned plans, lessons, and task-ledger lifecycle updates directly to the default branch unless the user explicitly requests a PR; worker product-code changes still require PRs."
- Dispatch/plan guardrail:
  - Before creating a PR, classify the changes as worker implementation or orchestrator state; do not create a PR for the latter by default.
- Residual risk / waiver:
  - Direct default-branch writes remain limited to orchestrator-owned coordination artifacts, not product code.

Evidence:
- User correction on 2026-07-11; PR #645 closed and equivalent commits pushed directly to `master`.

## 2026-07-11 — Review Task Size Before Plan Approval  [tags: planning, task-sizing, scope, orchestration]

Context:
- Plan: `docs/coding-agent/plans/active/codebase-review-remediation-roadmap-plan.md` and its child plans
- Task/Wave: plan authoring and pre-dispatch review
- Roles involved: Orchestrator, Reviewer

Symptom:
- Several plan Tasks still combined multiple independently shippable responsibilities even after the findings had been split into separate plan files.
- Schema/migration, runtime behavior, multiple provider implementations, and CI/E2E setup were grouped too broadly for narrow Worker ownership.

Root cause:
- Plan review emphasized required fields, finding coverage, and file-level splitting, but did not apply an explicit complexity/size gate to each Task.

Fix applied:
- Re-audited every Task by behavior count, runtime boundary, package count, production-file count, and independent validation path; split oversized Tasks and rebuilt dependencies/waves.

Prevention:
- Dispatch/plan guardrail:
  - Before plan approval, split any Task that combines schema/migration with runtime changes, spans independent providers, or mixes product implementation with CI/E2E infrastructure unless inseparability is documented.
  - Prefer one primary behavior, one runtime boundary, at most four production files, and one package/app per Worker Task.
- Repo rule candidate:
  - audience: orchestrator
  - proposed rule: "Run a task-size audit before plan approval and replan any Task with multiple independently shippable behaviors or validation paths."
- Harness migration candidate:
  - category: plan-format
  - proposed_home: `plan-format` plan-integrity checklist
  - generalized_rule: Task integrity includes bounded size and complexity, not only complete fields and valid `owns`.
  - suggested_change: Add behavior-count, boundary-count, and independent-validation split prompts to the plan-integrity checklist.
- Residual risk / waiver:
  - none

Evidence:
- Updated remediation plans; independent task-size Reviewer status `APPROVED` after splitting runtime and migration test paths.

## 2026-07-08: Return unmet merge gates to workers immediately

- tags: orchestration, merge-gate, ci, review
- symptom: Parent orchestrator waited for a PR's Greptile status to finish during merge gate instead of returning the unmet gate to the worker.
- root cause: Treated pending CI/AI review as an acceptable parent-side wait state even after the worker had handed off merge-ready status.
- fix: Interrupt parent-side long waits when any required merge gate remains incomplete and send the PR back to the worker with the exact unmet gate.
- prevention: During orchestrator merge gate, if CI, AI review, review decision, base currency, conflict status, validation, or hook exit 0 is not currently satisfied, stop parent-side merging and require the worker to continue until the gate is satisfied or a concrete blocker is reported.

## 2026-07-06: Split requested plans as separate artifacts, not only waves

- tags: planning, output-contract, assumptions
- symptom: User asked to split a fix plan as needed, but the response created one large plan and only separated work by Task Waves.
- root cause: Treated harness wave decomposition as equivalent to the user's requested plan-level split.
- fix: Replace the single omnibus plan with multiple active plan files grouped by coherent product/implementation areas.
- prevention: When a user asks to split a plan, choose whether the split should be separate plan artifacts before using Task Waves; use waves only for execution sequencing inside each plan.

## 2026-07-04: Confirm all-of vs any-of semantics for multi-token validation

- tags: telemetry, validation, assumptions
- symptom: Telemetry investigation explained why v6 could be consumed before a 403, but did not challenge whether requiring both v4 and v6 tokens to match the submit IP was the intended behavior.
- root cause: Treated multiple telemetry tokens as cumulative requirements instead of alternative address-family evidence.
- fix: Update the implementation and tests so public form submission is allowed when at least one submitted telemetry token matches the submit-time IP, is unused, and is unexpired.
- prevention: When investigating security token failures with multiple submitted candidates, explicitly identify whether the contract is all-of, any-of, or quorum before calling behavior correct.

## 2026-07-04: Define post-authorization handling for non-matching token candidates

- tags: telemetry, replay-prevention, validation
- symptom: The any-match telemetry fix allowed submit when one v4/v6 token matched, but left the non-matching submitted token candidate unused.
- root cause: Focused on authorization semantics and did not separately define post-authorization replay prevention for other submitted candidates.
- fix: After at least one current-IP token authorizes submit, consume remaining submitted unused/unexpired token rows too.
- prevention: For multi-candidate one-time tokens, specify both authorization criteria and candidate burn/retention behavior before finalizing the implementation.

## 2026-07-05: Verify PR review decision after review-hook success

- tags: github, review-gate, validation
- symptom: A PR was reported merge-ready after `gh-review-hook` exited 0, but GitHub still showed `reviewDecision: CHANGES_REQUESTED` from a prior AI review.
- root cause: Closeout relied on hook exit status and CI success without separately checking the current PR review decision metadata.
- fix: Re-check PR metadata with `gh pr view --json reviewDecision,headRefOid,mergeStateStatus` after hook completion and continue iterating until the review decision is no longer `CHANGES_REQUESTED`.
- prevention: Treat `reviewDecision` as an explicit closeout guard for PR-worker handoff, alongside hook exit status, CI status, clean worktree, and local/remote head equality.

## 2026-07-08: Set explicit worker goals before implementation

- tags: orchestration, worker-delegation, goal-tracking
- symptom: Background workers can stop after setup or drift from the delegated task when no explicit goal is set in the worker thread.
- root cause: Worker delegation prompts described the task, but did not require the worker to create a Codex goal that persists across turns and resumptions.
- fix: Add a required instruction to worker delegation prompts: create a goal for the delegated task before implementation and keep it active until merge-ready, blocked, or intentionally stopped.
- prevention: Before starting or resuming a worker, verify the delegation includes goal setup. If an already-running worker lacks that instruction, send a follow-up asking it to create the task goal before continuing.

## 2026-07-08: Launch implementation workers with gpt-5.5 medium

- tags: orchestration, worker-delegation, model-selection
- symptom: A replacement implementation worker was started without explicitly setting the requested model and reasoning effort.
- root cause: The parent reused the default create-thread path after restarting a broken worker instead of applying the desired implementation-worker model default.
- fix: Start implementation worker threads with `model: gpt-5.5` and `thinking: medium`; if a model-unspecified replacement was just queued, supersede it and mark it abandoned in the ledger.
- prevention: Before creating any implementation worker, check the create-thread call includes `model: gpt-5.5` and `thinking: medium`. Non-implementation orchestration/status work can continue without this default unless explicitly requested.

## 2026-07-08: Run independent reviewer subagents as default GPT-5.5 when role routing misfires

- tags: review-gate, subagent, model-selection, validation
- symptom: A worker stopped with the independent reviewer gate unmet after harness_reviewer subagents errored through GPT-5.3-Codex-Spark usage limits, even when a GPT-5.5 override was attempted.
- root cause: Treated the role-specific reviewer failure as a hard blocker instead of retrying with a default subagent explicitly pinned to GPT-5.5.
- fix: Retry independent PR review with a default subagent using model `gpt-5.5` and a narrow review-only prompt.
- prevention: Before reporting an independent-review gate blocked by model routing or usage limits, attempt a default GPT-5.5 reviewer subagent and record the result.

## 2026-07-11: Preserve cancellation across every provider error-mapping layer

- tags: plugins, cancellation, external-integrations, error-mapping
- symptom: A provider propagated `AbortSignal` to its HTTP client but then converted the resulting abort rejection into its ordinary retryable validation error.
- root cause: Signal plumbing and provider error classification were reviewed separately, so the catch layers did not treat an already-aborted execution context as a control-flow boundary.
- fix: Pass the execution signal through client-scoped authentication fetches and endpoint requests, then rethrow abort rejections before 404, rate-limit, and generic provider mappings at both client and plugin layers.
- prevention: Cancellation regressions for external providers must verify both request-level signal propagation and that every subsequent catch layer preserves cancellation instead of translating it into domain failure.

## 2026-07-11: Assert the canonical abort reason separately from transport errors

- tags: plugins, cancellation, identity, testing
- symptom: A plugin correctly recognized an aborted request but rethrew the transport's `AbortError` instead of the execution signal's custom reason.
- root cause: The regression used the same conceptual cancellation for both the request rejection and controller state, so it did not test which object crossed the provider boundary.
- fix: Normalize recognized cancellation to `signal.reason ?? error` at each plugin/client boundary and test with distinct transport-error and custom-reason objects.
- prevention: Cancellation identity tests must deliberately make the caught transport error differ from `AbortSignal.reason` and assert that the canonical signal reason is returned by reference.

## 2026-07-11: Resolve async handoffs before asserting their terminal UI state

- tags: frontend, testing, async, state-machine
- symptom: A test named for successful redirect handoff asserted pending state while the mocked sign-in promise was still unresolved.
- root cause: In-flight loading and post-success handoff were treated as the same observable state, so the test could not detect a regression that cleared pending in `finally` after success.
- fix: Resolve the deferred operation with the successful handoff value inside `act`, await completion, then assert pending accessibility state and duplicate-submit suppression.
- prevention: Async state-machine tests must advance through the transition they name before asserting the resulting state; unresolved promises only prove the in-flight state.

## 2026-07-11: Reconcile automated findings with the established cross-layer contract

- tags: review-gate, ai-review, contracts, retries
- symptom: An automated reviewer repeatedly requested that a provider convert host deadline cancellation into a non-retryable result, contradicting the merged host retry/final-attempt policy.
- root cause: The review analyzed the provider catch path in isolation and treated all deadline expiry as terminal cancellation without reading the host-owned retry contract and lifecycle tests.
- fix: Preserve the canonical timeout reason for host classification, document the contract in the review thread, and request a fresh automated review after the dependent host implementation and tests were visible on the PR base.
- prevention: Before applying an automated cross-layer lifecycle finding, trace the value into its authoritative consumer and compare against focused contract tests; if the finding conflicts, resolve it with evidence and rerun the review rather than changing one layer in isolation.

## 2026-07-11: Trace cancellation identity through dependency error wrappers

- tags: plugins, cancellation, octokit, error-cause
- symptom: Direct abort-reason and `AbortError` tests passed, but Octokit wrapped a custom host timeout/shutdown reason in `RequestError` and stored the canonical reason in `cause`.
- root cause: Cancellation classification modeled browser fetch rejection but not the dependency's non-`AbortError` wrapping behavior.
- fix: While the execution signal is aborted, recognize a wrapper whose `cause` is the exact `signal.reason`, then rethrow the canonical reason; add separate wrapper/reason identity tests at client and plugin boundaries.
- prevention: For external HTTP libraries, inspect the locked dependency's rejection/wrapping path and test canonical cancellation identity through `cause` without treating unrelated causes as cancellation.
