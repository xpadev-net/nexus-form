# R8-M12 slice 1 verification (2026-05-22)

Dead code cleanup — first slice (fingerprint UI, legacy form components, duplicate exports).

| Category | Action | Notes |
|----------|--------|-------|
| Fingerprint UI | Removed `components/fingerprint/*`, `lib/fingerprint/*`, `types/fingerprint.ts` | `use-fingerprint.ts` hook retained; inline collection used by `public-form-page` |
| Legacy form blocks | Removed `components/form/*` except `external-service-validation-config.tsx` | Plate editor replaced block-based question components |
| Misc unused | Removed `use-debounced-value.ts`, `signout-button.tsx` | No import sites |
| Duplicate export | Removed `ALL_TEMPLATE_OPTIONS` / `DEFAULT_TEMPLATE_OPTIONS` aliases | `validation-providers.ts` uses `VALIDATION_PATTERN_TEMPLATES` directly |

Knip false positives retained: shadcn `components/ui/*`, TanStack Router entry files, `public/env-config.js`.
