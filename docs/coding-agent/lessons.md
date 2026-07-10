# Coding Agent Lessons

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
