# R23-L1 Publish Snapshot Copy Plan

## Scope

Add concise copy to the publish flow so users can identify which snapshot version will become public. Do not change API behavior or snapshot persistence logic.

Research waived: the delegated task names the affected UI surface narrowly, and local search confirmed the relevant components are under `apps/web/src/components/forms/form-publish-menu*`, `snapshot-save-dialog.tsx`, and `snapshot-graph.tsx`.

Repo rules: `docs/coding-agent/rules` is absent in this worktree, so validation follows `AGENTS.md` plus the harness baseline.

Quality routing note:
- Routing level: L1
- In-scope docs: orchestration-harness, plan-format, engineering-quality-baselines, AGENTS/CLAUDE task instructions
- Out-of-scope docs: backend/security/migration gates because this is local frontend copy and component tests only
- Top risks: UI ambiguity, regression in publish controls
- Risk profile: low; no API, auth, data contract, persistence, or dependency changes
- Required checks: component tests for the three requested states, `pnpm lint:fix`, `pnpm type-check`, `pnpm test -- --silent`, independent Reviewer

## Task Waves

Wave 1: Task_1
Wave 2: Task_2
Wave 3: Task_3

## Task_1

type: impl
owns:
- `apps/web/src/components/forms/form-publish-menu/**`
- `apps/web/src/components/forms/form-publish-menu.tsx`
- `apps/web/src/components/forms/snapshot-save-dialog.tsx`
- `apps/web/src/components/forms/snapshot-graph.tsx`
depends_on: []
acceptance:
- Unpublished changes section shows the next snapshot version that will be published.
- Snapshot save dialog distinguishes publish vs save-only behavior with the target version.
- Existing snapshot selection shows the version that will become the public version.
- No API calls or snapshot save behavior are changed.
validation:
- required: true
  owner: orchestrator
  kind: code-inspection
  detail: Verify changes are limited to frontend UI copy/state plumbing.

## Task_2

type: test
owns:
- `apps/web/src/components/forms/*.test.tsx`
depends_on:
- Task_1
acceptance:
- Initial publish state has component evidence for v1 target copy.
- Published form with unpublished changes has component evidence for next version copy.
- Existing snapshot switch has component evidence for selected version copy.
validation:
- required: true
  owner: orchestrator
  kind: component-test
  detail: Run focused web component tests covering the requested states.

## Task_3

type: review
owns:
- `apps/web/src/components/forms/**`
depends_on:
- Task_2
acceptance:
- Full required repository checks pass or have an explicit blocker.
- Independent Reviewer approves the implementation and evidence.
- PR is created, `gh-review-hook` exits 0, and the branch is merged.
validation:
- required: true
  owner: orchestrator
  kind: command
  detail: `pnpm lint:fix`, `pnpm type-check`, `pnpm test -- --silent`
- required: true
  owner: reviewer
  kind: review
  detail: Independent review of diff, acceptance criteria, and UI evidence.

## Progress Log

- Wave 1 complete: Added target-version copy to the unpublished changes section, snapshot save dialog, and snapshot history actions without changing publish or snapshot persistence behavior.
- Wave 2 complete: Added component-level evidence for initial publish, unpublished changes with next-version publish, and existing snapshot switch states.
- Wave 3 complete: `pnpm lint:fix`, `pnpm type-check`, and `pnpm test -- --silent` passed. Independent Reviewer initially requested one snapshot-history copy fix, then approved after the follow-up change.

## Decision Log

- User approval gate waived because the delegation explicitly requests completing R23-L1 end to end in this worktree.
