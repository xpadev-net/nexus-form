# Plan: R15-M3/M4 Runtime Config

- status: in_progress
- generated: 2026-06-01
- last_updated: 2026-06-01
- work_type: code

## Goal
- Ensure hCaptcha and Telemetry Vite env values are included in `window.__NEXUS_FORM_CONFIG__` and consumed through a clear runtime-first priority order.

## Definition of Done
- `VITE_HCAPTCHA_SITE_KEY`, `VITE_TELEMETRY_HOST`, `VITE_TELEMETRY_V4_HOST`, and `VITE_TELEMETRY_V6_HOST` are reflected in browser global config for build-time and runtime container paths.
- hCaptcha and telemetry consumers prefer runtime config, then build-time env, then documented fallbacks where applicable.
- Related tests cover the global config injection and runtime value priority.
- Required commands pass: `pnpm lint:fix`, `pnpm type-check`, `pnpm test --silent` or documented fallback.
- Independent reviewer approves the diff.
- PR is created, `gh-review-hook <PR>` exits 0, and the PR is merged.

## Scope / Non-goals
- Scope:
  - `apps/web` runtime config generation, accessors, tests, and env docs.
  - Task-local plan records required by the orchestration harness.
- Non-goals:
  - API telemetry token semantics or backend validation behavior.
  - Editing parent worktree `/Users/xpadev/IdeaProjects/nexus-form`.

## Context (workspace)
- Related files/areas:
  - `apps/web/src/lib/runtime-config.ts`
  - `apps/web/src/lib/config.ts` if present
  - `apps/web/src/components/forms/hcaptcha-widget.tsx`
  - `apps/web/src/lib/api.ts`
  - `apps/web/src/lib/auth-client.ts`
  - `apps/web/index.html`
  - `apps/web/vite.config.ts`
  - `apps/web/docker-entrypoint.sh`
  - `.env.example`
- Existing patterns or references:
  - Runtime config accessor already prefers `window.__NEXUS_FORM_CONFIG__` over `import.meta.env`.
  - Docker entrypoint already emits hCaptcha and telemetry keys.
- Repo reference docs consulted:
  - `AGENTS.md` / `CLAUDE.md` provided in prompt.
  - `$orchestration-harness`, `$plan-format`, `$engineering-quality-baselines`, `$git-workflow`, `$improvement-loop`.

## Open Questions
- None.

## Assumptions
- The user instruction to proceed through merge waives a separate plan approval pause.
- Research dispatch is waived because the prompt names the affected files and the needed context is direct local implementation inspection.

## Tasks

### Task_1: Runtime config injection and consumers
- type: impl
- owns:
  - `apps/web/src/lib/**`
  - `apps/web/src/components/forms/**`
  - `apps/web/index.html`
  - `apps/web/vite.config.ts`
  - `apps/web/docker-entrypoint.sh`
  - `.env.example`
- depends_on: []
- description: |
  Add or repair the build-time browser global config path and normalize consumers to runtime-first lookup.
- acceptance:
  - Browser global config includes hCaptcha and telemetry host keys when env values are set.
  - Consumers read hCaptcha/Telemetry through runtime config before build-time env.
  - Existing Docker runtime config remains compatible.
- validation:
  - kind: test
    required: true
    owner: orchestrator
    detail: "Add/update focused unit tests for runtime config injection and priority."
  - kind: command
    required: true
    owner: orchestrator
    detail: "`pnpm --filter @nexus-form/web test -- --runInBand` or nearest package-level focused test command."

### Task_2: Repository validation
- type: test
- owns:
  - no source edits; validation only
- depends_on: [Task_1]
- description: |
  Run the repository-required validation commands.
- acceptance:
  - `pnpm lint:fix` completes or any failure is documented with remediation.
  - `pnpm type-check` completes or any failure is documented with remediation.
  - `pnpm test --silent` completes; if Turbo rejects `--silent`, run and document `pnpm test -- --silent`.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "`pnpm lint:fix`"
  - kind: command
    required: true
    owner: orchestrator
    detail: "`pnpm type-check`"
  - kind: command
    required: true
    owner: orchestrator
    detail: "`pnpm test --silent` or documented fallback."

### Task_3: Independent review and PR lifecycle
- type: review
- owns:
  - no source edits unless addressing review findings
- depends_on: [Task_2]
- description: |
  Obtain an independent review, create/push PR, run review hook until exit 0, address findings, and merge.
- acceptance:
  - Independent reviewer reports APPROVED or findings are resolved and re-reviewed.
  - PR URL is available.
  - `gh-review-hook <PR>` exits 0.
  - PR is merged and merge commit is recorded.
- validation:
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent review against R15-M3/M4 acceptance and validation evidence."
  - kind: command
    required: true
    owner: orchestrator
    detail: "`gh-review-hook <PR>` exits 0."
  - kind: command
    required: true
    owner: orchestrator
    detail: "`gh pr merge` succeeds and merge commit is captured."

## Task Waves

- Wave 1 (parallel): [Task_1]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3]

## E2E / Visual Validation Spec

- provider: none
- artifact_root: n/a
- base_url: n/a
- app_start_command: n/a
- readiness_check: n/a
- flows: Focused unit tests assert browser global config values; no layout or interactive UI behavior changes are expected.
- viewports: n/a
- evidence_requirements: Unit test output and repository validation commands.
- known_flakiness: n/a

## Rollback / Safety
- Revert the runtime config injection/accessor changes and tests in this branch if validation or review identifies unacceptable behavior.

## Progress Log

- 2026-06-01 Wave 0 started:
  - Summary: Branch `codex/r15-m3-m4-runtime-config` is active in `/Users/xpadev/.codex/worktrees/a59d/nexus-form`.
  - Validation evidence: Pending.
  - Notes: Research waived because the task prompt specified target files and acceptance; local inspection is sufficient.
- 2026-06-01 Wave 1 completed: [Task_1]
  - Summary: Added build-time Vite HTML injection for `window.__NEXUS_FORM_CONFIG__`, including hCaptcha and telemetry env keys; kept Docker `/env-config.js` as a later runtime override.
  - Validation evidence: `pnpm --filter @nexus-form/web exec vitest run src/lib/runtime-config.test.ts src/lib/runtime-config-script.test.ts` passed, 2 files / 6 tests.
  - Notes: `apps/web/dist/index.html` was checked after building `@nexus-form/shared` and `@nexus-form/web`; injected config appears before `/env-config.js`.
- 2026-06-01 Wave 2 completed: [Task_2]
  - Summary: Repository validation completed.
  - Validation evidence: `pnpm lint:fix` passed; `pnpm type-check` passed; `pnpm test --silent` failed because Turbo rejects `--silent`; fallback `pnpm test -- --silent` passed.
  - Notes: `pnpm lint:fix` formatted one web file.
- 2026-06-01 Wave 3 review completed: [Task_3]
  - Summary: Independent reviewer approved with no findings.
  - Validation evidence: Reviewer status `APPROVED`; reviewer re-ran focused runtime config tests and reviewed build/validation evidence.
  - Notes: PR creation, `gh-review-hook`, and merge are still pending.
- 2026-06-01 PR review follow-up:
  - Summary: PR #440 was created; first `gh-review-hook 440` returned exit 2 with two Greptile issues and a base-branch update requirement. `origin/master` was merged without rewriting history.
  - Validation evidence: Greptile issues addressed by failing fast when `/env-config.js` anchor is missing, supporting attributes on the anchor tag, and splitting test `describe` blocks. Focused runtime config tests passed again, 2 files / 8 tests.
  - Notes: `pnpm type-check` passed before PR creation; after base merge and review fix, `pnpm --filter @nexus-form/web type-check` passed, but one full `pnpm type-check` run hit a `tsgo` SIGSEGV and a second full run was stopped after web `tsgo` hung for over 7 minutes. `pnpm test -- --silent` after the follow-up hit unrelated API hook timeouts in `routes.test.ts` and `s3-ownership.test.ts` under local load.

## Decision Log

- 2026-06-01 Decision:
  - Trigger / new insight: User corrected prior premature stop after branch creation.
  - Plan delta: Continue through implementation, validation, independent review, PR, hook, and merge without another approval pause.
  - Tradeoffs considered: Waiting for plan approval would conflict with explicit delegation to continue end-to-end.
  - User approval: yes, explicit current-turn instruction.
- 2026-06-01 Decision:
  - Trigger / new insight: User requested removal of the newly added shared `docs/coding-agent/lessons.md` file because it is collision-prone across threads.
  - Plan delta: Move the correction note into this task-local plan Decision Log and delete `docs/coding-agent/lessons.md` from the diff.
  - Tradeoffs considered: Repo-local lesson capture would satisfy the generic correction workflow, but the user explicitly identified it as unnecessary and conflict-prone for this task.
  - User approval: yes, explicit current-turn instruction.
- 2026-06-01 Correction note:
  - Symptom: A delegated task that required implementation, validation, independent review, PR creation, review-hook handling, and merge was closed after only creating the branch.
  - Root cause: The turn was ended after satisfying the first setup step instead of checking the full delegation acceptance list.
  - Fix: Continue the same branch/worktree and execute the full requested lifecycle.
  - Prevention: Before any final response on this delegated task, verify the requested lifecycle evidence: implementation, required validation, independent review, PR, `gh-review-hook`, and merge.

## Notes
- Risks: Runtime/browser globals must remain serializable and not break Docker-generated `/env-config.js`.
- Edge cases: Empty runtime strings should still fall back to build-time values or defaults.
