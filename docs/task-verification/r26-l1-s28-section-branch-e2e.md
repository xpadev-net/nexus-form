# R26-L1 S28 Section Branch Verification

## Scope

S28 was rechecked with a real section-branching fixture at component/integration-test level instead of a generated story fixture. The fixture keeps the first page as a required `radio` question with saved values `individual` / `corporate`, attaches a `jump_to_section` navigation rule to the next `form_section_separator`, and makes the corporate-only section contain a required company-name question.

## Automated Evidence

| Contract | Evidence |
|---|---|
| Corporate selection reaches the additional section | `apps/web/src/components/forms/form-body.test.tsx` -> `routes corporate respondents to the section branch and blocks submit until corporate required fields are answered` |
| Corporate required fields cannot be skipped | Same test asserts the missing `法人名` error before successful submit |
| Individual selection submits without visiting corporate section | `apps/web/src/components/forms/form-body.test.tsx` -> `submits the individual branch without visiting or serializing empty corporate answers` |
| Saved option value vs visible label mismatch is detectable | `apps/web/src/components/forms/form-body.test.tsx` -> `does not branch when a condition compares the choice label instead of the saved option value` |
| Valid non-adjacent section IDs jump to the intended section instead of physical next page | `apps/web/src/components/forms/form-body.test.tsx` -> `jumps to a non-adjacent corporate section when the rule target matches the section id` |
| Unknown section/page target falls back to physical next page and exposes the mismatch | `apps/web/src/components/forms/form-body.test.tsx` -> `falls back to the next physical page when a matching branch targets an unknown section id` |
| Public submit validation only checks visited branch questions | `apps/web/src/components/forms/public-form-page.test.tsx` -> `submits only visited branch answers from a section-branching public form` |
| Creator export/CSV keeps unvisited branch answers blank and readable | `apps/api/src/lib/forms/__tests__/response-export.test.ts` -> `keeps unvisited section-branch answers blank in creator export records and CSV` |

## Commands Run

```bash
pnpm --filter @nexus-form/shared build
pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-body.test.tsx src/components/forms/public-form-page.test.tsx
pnpm --filter @nexus-form/api exec vitest run src/lib/forms/__tests__/response-export.test.ts
```

## Manual QA Boundary

No browser E2E fixture generator was added because R26-M2 owns the story fixture generator area. The remaining manual QA boundary is a full browser pass with the eventual generated S28 fixture: create/publish form, select both `個人` and `法人`, confirm the creator response detail view, and download CSV. The core navigation, visited payload, required validation, label/value mismatch, section-id mismatch, and CSV blank-column contracts are now covered by focused automated tests.
