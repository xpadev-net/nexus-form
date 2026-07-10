# Skill Migration Candidates

## 2026-07-11 — Add task-size audit to plan integrity

- source: user correction during remediation plan review
- target: `plan-format` plan-integrity checklist
- problem: A plan can satisfy required Task fields and `owns` consistency while still assigning one Worker multiple independently shippable behaviors, runtime boundaries, providers, or validation paths.
- proposed change:
  - Require a pre-approval task-size audit.
  - Split Tasks that combine schema/migration with runtime behavior, independent providers, or product code with CI/E2E infrastructure unless inseparability is documented.
  - Prompt for one primary behavior and one runtime boundary per Worker Task.
  - Treat more than four production files, more than one package/app, or multiple independent validation paths as replan signals rather than absolute limits.
- evidence:
  - `docs/coding-agent/plans/active/codebase-review-remediation-roadmap-plan.md`
  - `docs/coding-agent/lessons.md` entry `2026-07-11 — Review Task Size Before Plan Approval`
- status: candidate
