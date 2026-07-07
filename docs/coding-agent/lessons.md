# Coding Agent Lessons

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
