# Plan: Share Link Token & Crypto Hardening

- status: draft
- generated: 2026-07-13
- last_updated: 2026-07-13
- work_type: code

## Goal
- Remediate the findings from the 2026-07-13 whole-codebase review: plaintext share-link tokens, share-link API token hygiene, encryption-key rotation readiness, and share-token log exposure.

## Definition of Done
- Share-link tokens are no longer stored or looked up as plaintext in the database.
- Share-link derived API tokens have correct names and bounded row growth.
- Encrypted field payloads carry a key version so `GOOGLE_OAUTH_ENC_KEY` can be rotated incrementally.
- `shareToken` query parameters are redacted from request logs.
- `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent` pass at the end of each task.

## Scope / Non-goals
- Scope: `formShareLink` token storage, `apps/api/src/lib/tokens/share-link-token.ts`, `apps/api/src/lib/dual-auth.ts`, `packages/shared/src/crypto/field-encryption.ts`, request-log redaction.
- Non-goals: changing the SSE `?shareToken=` query-auth mechanism itself (EventSource cannot set headers); re-auditing findings already owned by `codebase-review-remediation-roadmap-plan.md` child plans.

## Context (workspace)
- Source review: 2026-07-13 session whole-codebase review (Fable 5).
- Findings:
  1. **(Medium)** `formShareLink.token` is stored plaintext (`packages/database/src/schema.ts` `formShareLink`) and matched raw in `apps/api/src/lib/dual-auth.ts` (`authenticateWithShareLinkToken`) and `apps/api/src/lib/tokens/share-link-token.ts` (`validateShareLinkInternal`). API tokens by contrast use bcrypt + SHA-256 lookup hash (`apps/api/src/lib/tokens/hash.ts`). A DB dump leaks live EDITOR-capable credentials.
  2. **(Low, bug)** `validateShareLinkInternal` hardcodes `title: "Untitled"`, so every share-link API token is named `Share Link: Untitled`.
  3. **(Low)** `createApiTokenForShareLink` inserts a new `SHARE_LINK` row in `apiToken` on every call with no reuse or cleanup; rows with `expiresAt: NULL` accumulate unboundedly.
  4. **(Low)** `field-encryption.ts` payloads are `iv || authTag || ciphertext` with no key version, forcing all-at-once re-encryption on key rotation.
  5. **(Info)** `?shareToken=` on SSE GET endpoints may land in access logs; verify/extend the existing redaction (`sensitive-request-log-redaction-plan.md` predates this parameter).
- Constraint: share links must remain re-displayable to their owner. Full bcrypt hashing of `formShareLink.token` would break re-display; use a deterministic SHA-256 lookup-hash column for authentication lookups instead, and decide explicitly (Task_1) whether the plaintext column is retained for owner re-display or dropped in favor of show-once semantics.

## Task_1
- type: impl
- owns:
  - `packages/database/src/schema.ts`
  - `packages/database/drizzle/` (new migration)
  - `apps/api/src/lib/dual-auth.ts`
  - `apps/api/src/lib/tokens/share-link-token.ts`
  - `apps/api/src/lib/forms/permission-service.ts`
- depends_on: []
- acceptance:
  - `formShareLink` gains a unique `lookupHash` column (SHA-256 hex via `computeLookupHash`), backfilled by migration for existing rows.
  - `authenticateWithShareLinkToken` and `validateShareLinkInternal` look up links by `lookupHash`, never by raw token equality.
  - `createShareLink` / invitation flows populate `lookupHash` at insert time.
  - Decision recorded in this plan: plaintext `token` column retained for owner re-display (documented trade-off) or dropped with UI switched to show-once; implementation matches the decision.
  - Existing share links keep working after migration (backfill covers all active rows).
- validation:
  - required: true
    owner: orchestrator
    kind: unit
    detail: dual-auth and share-link-token tests cover lookup-hash authentication, expiry, and revocation paths
  - required: true
    owner: orchestrator
    kind: migration
    detail: `pnpm db:generate` output reviewed; backfill verified against seeded rows in a local MySQL run

## Task_2
- type: impl
- owns:
  - `apps/api/src/lib/tokens/share-link-token.ts`
- depends_on: [Task_1]
- acceptance:
  - `validateShareLinkInternal` (or its successor) joins the `form` table so issued tokens are named `Share Link: <actual form title>`.
  - `createApiTokenForShareLink` reuses an existing active, unexpired `SHARE_LINK` token for the same `shareLinkId` instead of inserting a new row per call, or revokes superseded rows on issue; either way row growth per share link is bounded.
  - Tokens issued for share links without expiry inherit a bounded default TTL or are cleaned up when the share link is deactivated.
- validation:
  - required: true
    owner: orchestrator
    kind: unit
    detail: tests assert token naming, reuse/cleanup behavior, and revocation propagation

## Task_3
- type: impl
- owns:
  - `packages/shared/src/crypto/field-encryption.ts`
  - `apps/api/src/lib/crypto/field-encryption.ts`
- depends_on: []
- acceptance:
  - Encrypted payloads gain a 1-byte key-version prefix; `decryptFromBase64` dispatches on it and still decrypts legacy version-less payloads (length/shape heuristic or explicit v0 fallback).
  - `decryptFromBase64` validates minimum payload length and throws a typed error on malformed input instead of an opaque crypto error.
  - A second key can be configured (e.g. `GOOGLE_OAUTH_ENC_KEY_V2`) enabling incremental rotation; encryption always uses the newest configured key.
- validation:
  - required: true
    owner: orchestrator
    kind: unit
    detail: round-trip tests for new-format payloads, legacy-payload decryption, malformed-input rejection, and two-key rotation

## Task_4
- type: impl
- owns:
  - `apps/api/src/lib/request-logging.ts`
- depends_on: []
- acceptance:
  - `shareToken` query parameter values are redacted from request logs and error targets (`getRequestErrorTarget`).
  - Existing redaction behavior for other sensitive parameters is unchanged.
- validation:
  - required: true
    owner: orchestrator
    kind: unit
    detail: request-logging tests assert `shareToken` redaction in logged URLs

## Task_5
- type: test
- owns:
  - `apps/api/src/__tests__/`
  - `apps/api/src/lib/tokens/__tests__/`
  - `packages/shared/src/crypto/__tests__/`
- depends_on: [Task_1, Task_2, Task_3, Task_4]
- acceptance:
  - Regression suite covers: share-link auth via lookup hash end-to-end (SSE query-param path included), token reuse semantics, crypto version round-trips, and log redaction.
  - `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent` pass workspace-wide.
- validation:
  - required: true
    owner: reviewer
    kind: full-suite
    detail: workspace lint, type-check, and test runs green before review sign-off

## Execution order
1. Task_1 (schema + auth lookup) — largest and blocks Task_2.
2. Task_3 and Task_4 in parallel with Task_1 (independent files).
3. Task_2 after Task_1 lands.
4. Task_5 as final verification gate.

## Rollout notes
- Task_1 migration must be applied before deploying API code that queries `lookupHash`; ship backfill and code in one release, keeping the plaintext-equality path only if a two-phase rollout is required.
- Task_3 is backward compatible by design (legacy payload fallback); no data migration needed, but plan an optional background re-encrypt once v1 keys are deployed everywhere.
