# Lessons Log (Coding Agent)

Purpose:
- capture recurring mistakes and the prevention mechanism
- enable "read once, don't repeat" improvements

## How to use
- Append a new entry after any user correction or significant miss.
- Keep entries short and actionable.
- Promote repeated/high-severity lessons into repo rules, harness migration candidates, troubleshooting notes, or accepted residual-risk records.

## Tags (recommended)
- planning
- validation
- delegation
- review
- ui-e2e
- tooling
- ci
- scope-owns

## Entries

## 2026-06-01 - Track New Test Files Before Review  [tags: review, git_hygiene]

Context:
- Plan: none
- Task/Wave: R14-L1 Spreadsheet refresh a11y
- Roles involved: Orchestrator | Reviewer

Symptom:
- Reviewer found the new spreadsheet selector test file was still untracked during review.

Root cause:
- The review packet was sent after implementation and validation, but before staging or otherwise verifying that new files were included in the branch diff.

Fix applied:
- Stage all task-owned changes before the follow-up review and verify staged status includes the new test file.

Prevention:
- Dispatch/plan guardrail:
  - Before reviewer dispatch on tasks that add files, run `git status --short` and confirm new files are tracked or explicitly included in the review packet as untracked work that will be staged.
- Residual risk / waiver:
  - none

Evidence:
- Reviewer report for agent `019e821b-bf0b-7c63-b905-2c47ebeb9d39` flagged `apps/web/src/components/forms/google-sheets-integration/spreadsheet-selector.test.tsx` as untracked.
