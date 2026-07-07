# Plan: Response Export And Sheets Unification

- status: completed
- generated: 2026-07-05
- last_updated: 2026-07-05
- work_type: code

## Goal
- CSV export and Google Sheets response sync use the same response output model, metadata policy, and choice display value resolution.
- Spreadsheet selection accounts for Google Drive folders and lets users browse candidates as a tree.

## Definition of Done
- CSV export and Sheets sync derive headers and rows from a shared export row builder.
- Metadata columns are defined by the CSV export contract and Sheets uses that same contract unless explicitly configured otherwise.
- Radio, dropdown, checkbox, choice grid, and checkbox grid answers are exported/synced as labels instead of internal ids.
- Section/header-only blocks are excluded from answer columns in CSV and Sheets sync.
- Spreadsheet picker can show folders and spreadsheets hierarchically, including duplicate names and currently linked spreadsheets.
- Required tests and repository validation pass: `pnpm lint:fix`, `pnpm type-check`, `pnpm test --silent`.

## Scope / Non-goals
- Scope:
  - `apps/api/src/lib/forms/response-export.ts`
  - `apps/api/src/routes/forms-responses.ts`
  - `apps/worker/src/handlers/sheets-sync.ts`
  - `apps/worker/src/handlers/__tests__/sheets-sync.test.ts`
  - `apps/api/src/__tests__/response-export.test.ts`
  - `apps/api/src/routes/integrations-google.ts`
  - `apps/api/src/types/domain/integrations-google.ts`
  - `apps/web/src/components/forms/google-sheets-integration/**`
- Non-goals:
  - No database schema migration unless implementation discovers stored config must persist folder ids.
  - No change to form submission storage shape beyond preserving existing display-label enrichment behavior.
  - No Google Sheets backfill job for already-synced historical rows unless requested separately.

## Context (workspace)
- Related files/areas:
  - CSV export currently uses `buildResponseExportRecords` and `formatRecordsToCsv` in `apps/api/src/lib/forms/response-export.ts`.
  - Sheets sync currently has its own `buildRowFromResponse` in `apps/worker/src/handlers/sheets-sync.ts`, using `safeParseResponseData` and title-only headers.
  - Choice label helpers already exist in `apps/api/src/lib/forms/response-choice-labels.ts`.
  - Section/header-like blocks appear as `section_separator` / `form_section_separator` in existing tests and should not become answer columns.
  - Spreadsheet list endpoint is `GET /api/integrations/google/spreadsheets` in `apps/api/src/routes/integrations-google.ts` and currently requests Drive `files(id,name)` only.
  - Spreadsheet selector UI is `apps/web/src/components/forms/google-sheets-integration/spreadsheet-selector.tsx`.
- Existing patterns or references:
  - API response schemas use zod and are colocated in route/domain files.
  - Frontend data fetching uses TanStack Query in `use-google-sheets-integration-model.ts`.
  - UI component tests exist for the selector and should be extended before browser validation.
- Repo reference docs consulted:
  - `AGENTS.md` task instructions in the thread.
  - Repository rule suite absent: `docs/coding-agent/rules` does not exist.

## Open Questions (max 3)
- Q1: Should Sheets keep two header rows (`idRow` and title row) as in `mapRecordToSheetRow`, or should it remain one visible header row while still using shared metadata and label resolution?
- Q2: For existing Sheets integrations, should newly added CSV metadata columns be appended only for future rows, or should existing header rows be rewritten to the full CSV contract?
- Q3: Should the Drive tree include shared drives and shortcuts, or only `myDrive` folders/spreadsheets returned by the current OAuth scopes?

## Assumptions
- A1: "メタデータ周りはcsv側に統一" means CSV is the canonical column set/order/naming, and Sheets sync should adopt it.
- A2: Choice answers should remain stored as ids internally, but export/sync output should use labels.
- A3: Existing API scopes already include `drive.readonly`, so listing folders can use the Drive API without another OAuth prompt unless shared-drive support requires additional query parameters.

## Tasks

### Task_1: Define shared response output contract
- type: design
- owns:
  - docs/coding-agent/plans/active/response-export-sheets-unification-plan.md
  - apps/api/src/lib/forms/response-export.ts
  - apps/api/src/__tests__/response-export.test.ts
- depends_on: []
- description: |
  Make `response-export.ts` expose a shared, destination-neutral row model for metadata headers, component headers, and stringified cell values. Keep CSV rendering as a thin formatter over that model.
- acceptance:
  - Shared helper returns deterministic header ids, display titles, and row values for empty and non-empty responses.
  - CSV output is behaviorally unchanged except where later tasks intentionally change metadata or labels.
  - Formula neutralization remains covered for headers and cell values.
  - Duplicate titles and unvisited section-branch answers stay covered.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/response-export.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Verify the contract is destination-neutral and CSV is only formatting, not recomputing columns."

### Task_2: Reuse shared output contract in Sheets sync
- type: impl
- owns:
  - apps/worker/src/handlers/sheets-sync.ts
  - apps/worker/src/handlers/__tests__/sheets-sync.test.ts
  - apps/api/src/lib/forms/response-export.ts
  - apps/api/src/__tests__/response-export.test.ts
- depends_on: [Task_1]
- description: |
  Replace the worker-local `buildRowFromResponse` path with the shared response output contract. Preserve idempotency, locking, snapshot-version title resolution, and uniqueness score behavior.
- acceptance:
  - Sheets sync uses the same metadata column definitions as CSV.
  - Existing idempotency detection still finds `Response ID` in current sheets.
  - Header expansion remains append/update safe under the existing Redis lock.
  - Worker no longer has a separate answer stringification policy.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/sheets-sync.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/response-export.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review idempotency, header migration, and retry behavior against current Sheets sync tests."

### Task_3: Make CSV metadata canonical and choice outputs label-based
- type: impl
- owns:
  - apps/api/src/lib/forms/response-export.ts
  - apps/api/src/lib/forms/response-choice-labels.ts
  - apps/api/src/__tests__/response-export.test.ts
  - apps/worker/src/handlers/__tests__/sheets-sync.test.ts
- depends_on: [Task_1, Task_2]
- description: |
  Formalize CSV metadata headers as the canonical export metadata set/order. Ensure selection-style answers write labels to both CSV and Sheets, including grid row/column labels and "other" labels.
- acceptance:
  - Metadata header tests assert the canonical CSV order and Japanese/English title mapping where both are needed.
  - `radio`, `dropdown`, and `checkbox` use option labels in output rows.
  - `choice_grid` and `checkbox_grid` use row/column labels in output rows.
  - Unknown option ids still fall back to the original id/value rather than blanking data.
  - Stored `responseDataJson` remains id-based; this task only changes export/sync output.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/response-export.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/sheets-sync.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review choice-label fallback behavior and metadata compatibility with existing exports."

### Task_4: Add Drive folder tree spreadsheet selection
- type: impl
- owns:
  - apps/api/src/routes/integrations-google.ts
  - apps/api/src/types/domain/integrations-google.ts
  - apps/api/src/__tests__/integrations-google-spreadsheets.test.ts
  - apps/web/src/components/forms/google-sheets-integration/**
- depends_on: []
- description: |
  Extend spreadsheet listing to include Drive folder context and update the selector from a flat recent list to a folder-aware tree/browser. Keep search available and make duplicate names distinguishable by path.
- acceptance:
  - API validates and returns spreadsheet folder metadata, such as parent ids and folder names/path segments.
  - Drive query fetches spreadsheet and folder data needed to build a tree, with pagination handled explicitly.
  - UI displays folders and nested spreadsheets in a scannable tree with current selection and search states.
  - Duplicate spreadsheet names are disambiguated by path or compact id.
  - Existing create-new-spreadsheet and sheet-selection flows still work.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/integrations-google-spreadsheets.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/web exec vitest run src/components/forms/google-sheets-integration/spreadsheet-selector.test.tsx src/components/forms/google-sheets-integration/use-google-sheets-integration-model.test.tsx"
  - kind: e2e
    required: true
    owner: reviewer
    detail: "Run Playwright visual/E2E checks for the integration settings UI using the spec below."
  - kind: review
    required: true
    owner: reviewer
    detail: "Review API contract, accessibility roles, tree keyboard/mouse behavior, and no text overlap on mobile/desktop."

### Task_5: Exclude section headers from answer exports
- type: impl
- owns:
  - apps/api/src/lib/forms/response-export.ts
  - apps/api/src/__tests__/response-export.test.ts
  - apps/worker/src/handlers/__tests__/sheets-sync.test.ts
- depends_on: [Task_1, Task_2]
- description: |
  Ensure section/header-only blocks are treated as layout/navigation metadata, not answer components. They must not produce CSV headers, CSV cells, Sheets headers, or Sheets cells.
- acceptance:
  - CSV export excludes `section_separator`, `form_section_separator`, and other explicitly non-answer/system/header-only block types from component columns.
  - Sheets sync excludes the same block types through the shared output contract rather than a worker-only filter.
  - Empty-response CSV headers include only answerable question blocks, not section headers.
  - Tests cover a form containing section headers before, between, and after answerable questions.
  - Section branch behavior for unvisited answerable questions remains blank rather than removing legitimate question columns.
- validation:
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/api exec vitest run src/__tests__/response-export.test.ts"
  - kind: command
    required: true
    owner: worker
    detail: "pnpm --filter @nexus-form/worker exec vitest run src/handlers/__tests__/sheets-sync.test.ts"
  - kind: review
    required: true
    owner: reviewer
    detail: "Review that filtering is based on block/question answerability, not just display title or missing response data."

### Task_6: Full validation and integration review
- type: review
- owns: []
- depends_on: [Task_2, Task_3, Task_4, Task_5]
- description: |
  Run repo-required validation and perform an integration review across API, worker, and web changes.
- acceptance:
  - All required repo commands pass or failures are documented with root cause and owner.
  - Reviewer approves the complete change against this plan.
  - No unresolved behavior gaps remain for existing Sheets integrations.
- validation:
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm lint:fix"
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm type-check"
  - kind: command
    required: true
    owner: orchestrator
    detail: "pnpm test --silent"
  - kind: review
    required: true
    owner: reviewer
    detail: "Independent final review with attention to export correctness, Sheets idempotency, and UI regressions."

## Task Waves (explicit parallel dispatch sets)

- Wave 1 (parallel): [Task_1, Task_4]
- Wave 2 (parallel): [Task_2]
- Wave 3 (parallel): [Task_3, Task_5]
- Wave 4 (parallel): [Task_6]

## E2E / Visual Validation Spec

- provider: playwright-cli
- artifact_root: `.playwright-cli/response-export-sheets-unification/`
- base_url: `http://localhost:3000`
- app_start_command: `pnpm dev`
- readiness_check: "Web app responds on port 3000 and API responds on port 3001."
- flows:
  - Open a form's Google Sheets integration settings.
  - Open the spreadsheet selector.
  - Verify folders can expand/collapse and nested spreadsheets can be selected.
  - Search for a spreadsheet and verify path/id disambiguation remains visible.
  - Confirm changing an existing linked spreadsheet still shows the confirmation dialog.
- viewports:
  - desktop: 1440x900
  - mobile: 390x844
- evidence_requirements:
  - Screenshots for closed selector, tree open, search results, and confirmation dialog.
  - Console errors checked and summarized.
  - Network failures checked and summarized.
- known_flakiness:
  - Google OAuth and real Drive calls should be mocked or run against test fixtures during UI validation.

## Rollback / Safety
- Revert the shared output contract first if CSV output breaks.
- Sheets sync changes are isolated to worker row/header generation and can be reverted without changing queue contracts.
- Drive tree API/UI can be feature-flagged or reverted independently from export/sync commonization if needed.

## Progress Log (append-only)

- 2026-07-05 Draft created.
  - Summary: Planned shared export contract, Sheets reuse, canonical metadata/labels, and Drive tree selection.
  - Validation evidence: Not run; planning only.
  - Notes: Repository rule suite is absent.
- 2026-07-05 Draft updated.
  - Summary: Added section/header-only block exclusion as Task_5.
  - Validation evidence: Not run; planning only.
  - Notes: User requested section headers not be treated like answer data in CSV.
- 2026-07-05 Completed.
  - Summary: ORCH-1 through ORCH-5 were implemented through worker PRs and merged; ORCH-6 final integration validation passed on updated master.
  - Validation evidence: `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent` passed after the final merge. Task-level targeted tests and review evidence are recorded in `docs/coding-agent/task-ledger.md`.
  - Notes: Parent `gh-review-hook 611` rerun was stopped after a prolonged stale wait on Greptile description review update, with direct GitHub checks/reviews successful and worker final hook exit 0.

## Decision Log (append-only; re-plans and major discoveries)

- 2026-07-05 Decision:
  - Trigger / new insight: Existing code already has partial CSV/Sheets common helpers in API, while worker Sheets sync still has independent row construction.
  - Plan delta (what changed): Make `response-export.ts` the shared contract boundary before changing worker behavior.
  - Tradeoffs considered: Moving shared code into `packages/shared` would avoid API-to-worker coupling, but may pull Node-specific export logic and dependencies into shared. First implementation should assess whether a package-level move is necessary.
  - User approval: no

## Notes
- Risks:
  - Worker importing API-local helpers may be undesirable; if package boundaries reject this, move destination-neutral export code into `packages/shared` or a dedicated workspace package.
  - Changing Sheets metadata columns can affect existing sheets with old headers.
  - Drive folder trees can be expensive if full recursive traversal is attempted; prefer paginated/root-scoped browsing or search-backed lazy loading.
- Edge cases:
  - Empty option labels, unknown option ids, "other" values, and duplicate question titles.
  - Section/header-only blocks before, between, and after answerable questions.
  - Existing sheets without `Response ID` header.
  - Shared drives, shortcuts, orphaned files, and duplicate folder names.
