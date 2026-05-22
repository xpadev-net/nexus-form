# R8-M12 slice 3 verification (2026-05-22)

Dead code cleanup — orphaned lib/types modules (no import sites).

| Removed | Notes |
|---------|-------|
| `lib/constants/forms.ts` | Legacy form navigation constants |
| `lib/constants/messages.ts` | Unused message strings |
| `lib/forms/short-text-placeholder.ts` | Orphaned after Plate migration |
| `lib/utils/deep-equal.ts` | No consumers |
| `lib/validation/error-messages.ts` | Only referenced by removed placeholder helper |
| `types/forms/public-form.ts` | Legacy public-form response types |

Knip false positives still expected: shadcn `components/ui/*`, `public/env-config.js`, `hooks/use-mobile.ts` (only referenced by unused sidebar).
