# R26-M1 responses / analytics / CSV QA ledger

## 目的

30 専用フォームの作成者側確認を、R26-M2 の fixture 生成物と focused tests で再実行できる回帰台帳に固定する。対象は回答一覧、回答詳細、分析、CSV export。公開フォーム作成と回答送信そのものは R26-M2 の fixture 生成と公開 URL 確認を前提にする。

## 前提 fixture

- 生成手順: `docs/task-verification/r26-m2-story-fixture-generator.md`
- dry-run: `pnpm --filter @nexus-form/api exec tsx ../../scripts/story-fixture-generator.ts --dry-run --sample-responses`
- local 生成: `NEXUS_FORM_API_TOKEN=<owner-write-or-admin-token> NEXUS_FORM_API_URL=http://localhost:3001 NEXUS_FORM_WEB_URL=http://localhost:3000 pnpm --filter @nexus-form/api exec tsx ../../scripts/story-fixture-generator.ts --sample-responses`
- cleanup 境界: `Codex Story QA 2026-06-04` prefix に完全一致するフォームだけを既存 API 経由で削除する。DB 直接編集はしない。
- credential smoke: Discord/GitHub/Twitter/X/Google Sheets 実 credential、worker queue、外部 provider は R26-M3 の対象なので本台帳では手動 credential 証跡を残さない。

## Fixture mapping note

R26-M2 merge commit `cad1665d0f5e49e659d68ae83230814e899b713d` の generator は S16 を response ID exposure、S19/S20 を validation/detail、S28 を Sheets UI として定義している。一方、R26-M1 委譲では S16 CSV の date/time/datetime/rating/slider、S19/S20 grid 分析、S28 条件分岐表示が再確認対象になっている。

この差分を generator 本体の大幅変更で吸収せず、以下で回帰対象を固定する。

- S16: `apps/api/src/lib/forms/__tests__/response-export.test.ts` で CSV の `送信日時`、`date`、`time`、`rating`、`linear_scale` を固定する。現行回答型に `datetime` はないため、CSV メタデータの `送信日時` を日時列として扱う。
- S19/S20: `apps/api/src/lib/forms/__tests__/response-analytics.test.ts` で choice grid / checkbox grid の集計 payload がエラーなく表示可能な形になることを固定する。
- S28: `apps/web/src/components/forms/response-detail-view.test.tsx` と CSV export test で、未訪問分岐の回答が詳細・CSV に混入しないことを固定する。実セクション分岐 fixture/E2E は R26-L1 の対象。

## 30 story ledger

| Story | Public submit expectation | Responses list expectation | Detail expectation | Analytics expectation | CSV expectation |
|---|---|---|---|---|---|
| S01 | all major question sample response is saved once | list count is 1 and submittedAt/JP metadata is visible | short/long/choice/grid/date/time/rating answers are shown; section block is excluded | every answerable block has total_responses 1; grid blocks have row/column labels | headers include all answerable block titles; section block is excluded |
| S02 | confirmation fixture response is saved once | list count is 1 | respondent name is visible with response ID metadata available | short_text analytics has one response | CSV has respondent name and response metadata |
| S03 | password-protected form accepts one sample response after access is satisfied | list count is 1 | protected answer is visible to creator | short_text analytics has one response | CSV includes protected answer only, no password data |
| S04 | searchable keyword/notes response is saved once | list count is 1; search terms can filter the same response | keyword and notes are visible | short/long text analytics each have one response | CSV includes keyword and notes columns |
| S05 | CSV fixture response is saved once | list count is 1 | CSV text and choice label are visible | text and radio analytics have one response | CSV export succeeds; API/HTML errors remain sanitized by component tests |
| S06 | public URL smoke answer is saved once | list count is 1 for the current form | URL smoke answer is visible | short_text analytics has one response | CSV includes the current form response only |
| S07 | share QA answer is saved once | owner/editor can see count 1 | shared answer is visible to authorized creator | short_text analytics has one response | CSV includes share QA answer and no share token/URL |
| S08 | Sheets row value response is saved once | list count is 1 | sheet row value is visible | short_text analytics has one response | CSV can be used as Sheets row source without credential evidence |
| S09 | duplicate/archive answer is saved once for source fixture | list count is 1 for the source form | duplicate answer is visible | short_text analytics has one response | CSV includes source answer; archived/duplicated form behavior is checked separately |
| S10 | prefill-supported text/date response is saved once | list count is 1 | prefill text and date are visible | text/date analytics have one response | CSV includes prefill text and date |
| S11 | schedule answer is saved once on the active fixture | list count is 1 | schedule answer is visible | short_text analytics has one response | CSV includes active fixture answer only |
| S12 | appearance rating response is saved once | list count is 1 | rating value is visible | rating analytics has one counted option | CSV includes rating value |
| S13 | duplicate-label choice and accessible grid response is saved once | list count is 1 | selected duplicate-label choice and grid row/column are visible | radio and choice_grid analytics preserve label counts without crashing | CSV uses display labels and grid row/column display value |
| S14 | required answer is saved once after submit | list count is 1 | required answer is visible | short_text analytics has one response | CSV includes required answer |
| S15 | password/snapshot fixture response is saved once | list count is 1 on active snapshot form | snapshot answer is visible | short_text analytics has one response | CSV includes active snapshot response only |
| S16 | response ID fixture response is saved once; CSV focused test covers date/time/rating/slider values | list count is 1 | ID answer is visible; CSV test validates submitted datetime metadata | short_text analytics has one response; numeric/date/time CSV types are covered by API test | headers/values for `送信日時`, date, time, rating, linear_scale are fixed by `response-export.test.ts` |
| S17 | notification subject response is saved once even if enqueue is fail-open | list count is 1 | notification answer is visible | short_text analytics has one response | CSV includes notification answer and no notification credential data |
| S18 | grid analytics fixture response is saved once | list count is 1 | choice_grid and checkbox_grid values are visible | grid analytics has row/column counts and no invalid notice for fixture payload | CSV includes grid display values |
| S19 | validation subject response is saved once; R26-M1 focused test covers choice grid analytics | list count is 1 | validation subject is visible | choice grid analytics payload is renderable with row/column counts and no invalid notice | CSV includes saved validation subject; grid coverage is fixed by analytics test |
| S20 | detail response is saved once; R26-M1 focused test covers checkbox grid analytics | list count is 1 | response detail and validation-result area render without hiding valid answers | checkbox grid analytics payload is renderable with row/column counts and no invalid notice | CSV includes saved detail answer; grid coverage is fixed by analytics test |
| S21 | date-range response is saved once | list count is 1 | date value is visible | date distribution has the submitted date | CSV includes date value |
| S22 | publish answer is saved once on active published snapshot | list count is 1 | publish answer is visible | short_text analytics has one response | CSV includes published fixture response |
| S23 | web component fixture response is saved once | list count is 1 | web short/dropdown values are visible | text/dropdown analytics have one response | CSV includes answerable component titles only |
| S24 | API submit fixture response is saved once | list count is 1 | API short/rating values are visible | text/rating analytics have one response | CSV includes API short and rating values |
| S25 | completion answer is saved once and response ID can be shown on completion | list count is 1 | completion answer is visible | short_text analytics has one response | CSV includes completion answer and response metadata |
| S26 | access-control answer is saved once after password access is satisfied | list count is 1 | access answer is visible | short_text analytics has one response | CSV includes access answer and no password/cookie data |
| S27 | share-link fixture answer is saved once | list count is 1 for authorized creator/editor | share-link answer is visible | short_text analytics has one response | CSV includes answer only, no share link token |
| S28 | Sheets UI fixture response is saved once; conditional branch detail is covered by focused test | list count is 1 | submitted branch fields are visible and unvisited branch fields are absent | short_text analytics has one response; real branch E2E remains R26-L1 | CSV keeps unvisited branch columns blank and does not mix branch-only values |
| S29 | CSV/analytics output fixture response is saved once | list count is 1 | output text and grid are visible | text and choice_grid analytics are available for screenshot evidence | CSV artifact contains the same response set as analytics |
| S30 | safe QA response is saved once | list count is 1 | safe QA answer is visible | short_text analytics has one response | CSV includes no secrets, credentials, private Sheet IDs, emails, or webhook URLs |

## 自動化

- API CSV: `pnpm --filter @nexus-form/api exec vitest run src/lib/forms/__tests__/response-export.test.ts`
  - S16 date/time/submitted datetime/rating/slider CSV header/value coverage
  - S28 unvisited branch answers stay blank in CSV
- API analytics: `pnpm --filter @nexus-form/api exec vitest run src/lib/forms/__tests__/response-analytics.test.ts`
  - S19/S20 choice_grid and checkbox_grid row/column aggregation is renderable and invalid notice is empty for valid payloads
- Web detail: `pnpm --filter @nexus-form/web exec vitest run src/components/forms/response-detail-view.test.tsx`
  - S28 creator detail shows submitted branch answers only
- Web CSV download event: `pnpm --filter @nexus-form/web exec vitest run src/components/forms/response-export.test.tsx`
  - download endpoint call, Blob URL, anchor download name, loading state, and sanitized error toasts
- Web analytics render: `pnpm --filter @nexus-form/web exec vitest run src/components/forms/form-response-analytics.test.tsx`
  - grid analytics block renders without the grid-format error state

## 手動確認が残る箇所と理由

- Full 30-form Playwright traversal is intentionally manual for this slice because authenticated creator navigation, fixture creation token, hCaptcha/public-submit behavior, and external credential-free setup vary by local/staging environment.
- R26-M2 sample responses are written through the owner/editor responses API, not public submit, to avoid real hCaptcha/telemetry tokens in CLI. Public URL rendering remains a manual check from the generator TSV output.
- S28 real section-branch E2E is tracked by R26-L1. This R26-M1 ledger fixes the creator detail/CSV contract against saved response payloads without changing the fixture generator body.
