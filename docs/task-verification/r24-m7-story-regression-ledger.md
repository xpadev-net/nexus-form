# R24-M7 story regression ledger

## 目的

2026-06-02 の localhost Chrome 実操作レビューで使った 30 ストーリーを、修正後に再確認しやすい形で分類する。今回の R24-M7 では runtime 実装や大量 E2E runner は追加せず、既存の API route test、component/unit test、手動 QA 証跡欄を台帳化する。

委譲文で参照された `docs/reviews/localhost-form-tool-story-review-2026-06-02.md` と `docs/reviews/localhost-form-tool-story-rereview-2026-06-02.md` は、この worktree と Git 履歴上では未検出だった。そのため、このファイルはそれら未コミット文書からの派生物としては扱わず、repo 内で追跡可能な R24-M7 の story 境界と回帰分類をここに固定する。分類根拠は、各 story 行に記録した既存の R23/R24/R25 PR、`docs/task-verification/**`、`e2e/README.md`、および現行テスト名に限定する。

後から元レビュー文書が見つかった場合は、別 PR で `docs/reviews/` に追加または安定 URL を記録し、この台帳との差分を cross-check する。元文書がない状態では、この台帳の 30 行を R24-M7 の再検証対象リストとして扱う。

## 分類

| 分類 | 用途 | 現状 |
|------|------|------|
| 自動 E2E | Playwright で実ブラウザ、認証、公開フォーム、Worker/SSE まで通す確認 | 既存 `e2e/system-external-service.spec.ts` などは外部サービス系のみ。30 ストーリー全体への新規追加は R24-M7 ではしない |
| API route test | Hono route、公開 submit、認可、enqueue、Sheets、post-submit 設定の契約固定 | 主要な保存・公開・送信・queue 境界は既存 test あり |
| component/unit test | Web UI の表示、操作、toast、React Query 状態、pure helper の固定 | Chrome レビューで見つかった UI feedback は主にここで固定済み |
| 手動 QA | 実ブラウザで URL、clipboard、外部接続、スクリーンショット、response ID を証跡化 | 実サービス credential や専用 QA Sheet を使うものは手動に分離 |

## 30 story ledger

| Story | 回帰シナリオ | 主分類 | 既存 PR / 自動証跡 | 残る手動確認 |
|------|--------------|--------|--------------------|--------------|
| S01 | 全設問フォームを公開して major question types を送信する | API route test | PR #465, #466。`apps/api/src/__tests__/forms-public-validation-outbox.test.ts` の `accepts and stores a valid public submission covering major question types` | 実ブラウザで全設問を入力し、送信後の response ID と回答詳細を記録 |
| S02 | 送信成功確認フォームで custom title/message/link/contact/response ID を表示する | API route test + component/unit test | PR #485, #486, #488。`forms-public-validation-outbox.test.ts` の `returns the published confirmation snapshot with the created response`、`public-form-page.test.tsx` の `switches to a completion screen with confirmation details and removes the submit UI after success`、`form-post-submit-settings.test.tsx` の post-submit tests | 成功画面スクリーンショット、response ID 表示/非表示、補足リンク遷移 |
| S03 | アクセス制御フォームで password gate と publish state を確認する | API route test + component/unit test | PR #474, #487。`authz-regression.test.ts` の `R4-H1: password protected public GET gates form body`、`forms-structure-password-protection.test.ts`、`password-protection-gate.test.tsx`、`form-access-control-settings.test.tsx` | 未認証 GET で本文非表示、誤 password、正 password、公開前後の snapshot 差分 |
| S04 | 回答一覧で本文検索し、空/検索中/error 状態を区別する | component/unit test | PR #472。`form-responses-page.test.tsx` の `passes the committed search term as q` と `distinguishes searching, empty, and error states` | 実ブラウザで検索語、ページ切替、選択解除をスクリーンショット化 |
| S05 | CSV export の loading、成功、API error、HTML error sanitize を確認する | component/unit test + API unit test | PR #478。`response-export.test.tsx`、`apps/api/src/lib/forms/__tests__/response-export.test.ts` | ダウンロードされた CSV のヘッダ/文字化け/ファイル名 |
| S06 | 公開 URL を再生成し、影響確認と copy action を確認する | component/unit test + API route test | PR #477。`form-public-url-settings.test.tsx`、`forms-detail-regenerate-public-url-rate-limit.test.ts` | 旧 URL が使えないこと、新 URL で公開フォームが表示されること |
| S07 | 共有リンクフォームで VIEWER/EDITOR link と collaborator permission を確認する | API route test + component/unit test | PR #471, #464。`forms-share-permissions-r23.test.ts`、`forms-permissions-share-links-auth.test.ts`、`share-link-manager.test.tsx`、`form-sharing-r23.test.tsx` | QA owner/invitee 2 アカウントで link role、clipboard fallback、削除後 403/404 |
| S08 | Sheets 専用フォームで spreadsheet 選択、manual sync、status を確認する | API route test + component/unit test | PR #475, #459。`integrations-google-spreadsheets.test.ts`、`forms-integrations-google-sheets-sync-auth.test.ts`、`spreadsheet-selector.test.tsx`、`use-google-sheets-sync.test.tsx` | QA 専用 Sheet で append 結果、job ID、失敗時 AUTH_REQUIRED 表示 |
| S09 | duplicate/archive feedback と destructive action を確認する | component/unit test | PR #480。`form-duplicate-archive-actions.test.tsx` | 実ブラウザで複製後の遷移、archive 後の一覧状態 |
| S10 | prefill generator で対応/非対応 question guidance と URL copy を確認する | component/unit test | PR #479。`form-prefill-generator.test.tsx`、`apps/web/src/lib/forms/prefill.test.ts` | 生成 URL を公開/preview で開き、値が初期表示されること |
| S11 | schedule UI の error/retry/recovery actions を確認する | component/unit test + API route test | PR #476, #463。`schedule-manager.test.tsx`、`forms-public-validation-outbox.test.ts` の scheduled public form visibility cases | 短時間 publish/unpublish/snapshot switch の実時計 QA |
| S12 | appearance question numbers、preview、contrast warning を確認する | API route test + component/unit test | PR #484。`forms-structure-appearance-route.test.ts`、`form-appearance-settings.test.tsx`、`form-body.test.tsx` の question numbers tests | 公開後に appearance が snapshot として反映されるスクリーンショット |
| S13 | public choice labels と grid cell accessible names を確認する | component/unit test + API unit test | PR #481。`form-choice-labels-a11y.test.tsx`、`response-choice-labels.test.ts` | スクリーンリーダー/keyboard で重複ラベル選択が可能なこと |
| S14 | public submit 完了後、二重送信や required error 復活が起きない | component/unit test | PR #486。`public-form-page.test.tsx` の `keeps double-clicks from sending twice or reviving required errors after success` | 低速ネットワーク相当で submit 連打し、request が 1 回であること |
| S15 | password protection の公開状態が active snapshot と draft で混ざらない | API route test | PR #487。`authz-regression.test.ts` の `keeps the old public snapshot unprotected until the protected snapshot becomes active`、`forms-structure-password-protection.test.ts` | 旧公開 URL/新 snapshot で gate 表示が切り替わること |
| S16 | post-submit response ID exposure を設定で出し分ける | API route test + component/unit test | PR #488。`forms-public-validation-outbox.test.ts` confirmation snapshot、`form-post-submit-settings.test.tsx` の `show_response_id` payload assertions | 成功画面に response ID が表示/非表示で切り替わるスクリーンショット |
| S17 | submit notification enqueue が成功送信を阻害しない | API route test + worker unit test | PR #489。`forms-public-validation-outbox.test.ts` の notification enqueue cases、`form-submit-notifications.test.ts`、`queues.test.ts`、`worker-queue-selection.test.ts` | 実 webhook/email は credential 依存。送信先 secret を証跡に残さず job ID と channel status だけ記録 |
| S18 | grid response analytics が 1x1 / multi-row / invalid payload で壊れない | API unit test + component/unit test | PR #482。`response-analytics.test.ts`、`form-response-analytics.test.tsx`、`grid-chart-charts.test.tsx` | 実回答を複数入れて chart 表示、invalid payload notice 件数を確認 |
| S19 | 外部 validation provider mock で成功/失敗/retry/再検証を確認する | 自動 E2E 参考 + manual QA | PR #483。`docs/task-verification/r25-m4-validation-provider-mock-e2e.md`、provider/worker/API focused tests。既存 `e2e/system-external-service.spec.ts` 系は外部サービス E2E の参考で、mock provider 回帰そのものは手動 mock E2E に分離 | `VALIDATION_PLUGINS_DIR` mock で Queue/SSE/回答詳細/再検証を証跡化 |
| S20 | response detail で validation results と失敗理由が見える | component/unit test | R9-H6 既対応。`response-detail-view.test.tsx`、`validation-result-list.test.tsx` | 回答詳細 screenshot、validationResultId、retry/cancel 操作結果 |
| S21 | public date question の required/range state を確認する | API route test + component/unit test | PR #473。`form-body.test.tsx` date paging tests、`forms-public-validation-outbox.test.ts` major question fixture | 日付 min/max を外したときに次ページへ進めないこと |
| S22 | publish snapshot copy が初回/未公開変更/履歴 publish で明確 | component/unit test | PR #456。`publish-snapshot-copy.test.tsx`、`form-publish-menu.test.tsx` | 公開 menu screenshot、対象 version の文言 |
| S23 | 全設問フォーム fixture の Web component coverage | component/unit test | PR #465。`form-body.test.tsx` の `submits all answerable public question types and excludes section separators` | Playwright 化する場合は `e2e/helpers/form.ts` に all-question builder を追加する単位で分解 |
| S24 | 全設問フォーム fixture の API submit coverage | API route test | PR #465。`forms-public-validation-outbox.test.ts` の major question fixture と invalid patch table | file upload/signature 系が範囲外なら別 story として追加 |
| S25 | 送信成功確認フォーム fixture の API + UI coverage | API route test + component/unit test | PR #485, #486, #488。post-submit route、public completion screen、settings payload tests | 実ブラウザ evidence: screenshot、response ID、link/contact click |
| S26 | アクセス制御フォーム fixture の API + UI coverage | API route test + component/unit test | PR #474, #487。password gate/settings/structure tests | 実ブラウザ evidence: locked body API response、verified cookie、gate screenshot |
| S27 | 共有リンクフォーム fixture の API + UI coverage | API route test + component/unit test | PR #464, #471。share permissions route/UI tests | 実ブラウザ evidence: VIEWER link cannot access editor-only route、EDITOR link confirmation |
| S28 | Sheets 専用フォーム fixture の API + UI coverage | API route test + component/unit test | PR #459, #475。Sheets mutation/sync auth and selector tests | 実ブラウザ evidence: QA Sheet row, job status API assertion |
| S29 | CSV / analytics output fixture の保存値表示を確認する | API unit test + component/unit test | PR #466, #478, #482。`response-export.test.ts`、`response-analytics.test.ts`、`response-export.test.tsx` | CSV artifact と analytics screenshot を同じ response set で保存 |
| S30 | 安全 QA 環境と手動証跡運用を確認する | manual QA | PR #458。`docs/task-verification/r23-l3.md`、`e2e/README.md` の QA fixture 方針 | 実 credential、token、Sheet ID、メールアドレスを repo/PR/log に残さないこと |

## fixture inventory

| Fixture / フォーム | 既存 fixture/test | 不足と次の作業単位 |
|--------------------|------------------|--------------------|
| 全設問フォーム | `form-body.test.tsx` と `forms-public-validation-outbox.test.ts` が short/long/radio/checkbox/dropdown/linear_scale/rating/choice_grid/checkbox_grid/date/time と section separator 除外を固定 | Playwright 実ブラウザ化は未着手。追加する場合は `e2e/helpers/form.ts` に all-question builder、`e2e/public-all-question-submit.spec.ts` を 1 PR に分解 |
| 送信成功確認フォーム | `forms-public-validation-outbox.test.ts`、`public-form-page.test.tsx`、`form-post-submit-settings.test.tsx` が confirmation snapshot、completion screen、response ID 設定を固定 | Chrome 証跡は未固定。manual QA で response ID/API assertion/screenshot を台帳に添付 |
| アクセス制御フォーム | `authz-regression.test.ts`、`forms-structure-password-protection.test.ts`、`password-protection-gate.test.tsx`、`form-access-control-settings.test.tsx` | 実ブラウザで cookie と refetch を跨ぐ確認は手動。Playwright 化は auth setup が必要なため別作業 |
| 共有リンクフォーム | `forms-share-permissions-r23.test.ts`、`forms-permissions-share-links-auth.test.ts`、`share-link-manager.test.tsx`、`form-sharing-r23.test.tsx` | QA owner/invitee の 2 アカウント fixture は README 方針のみ。自動 E2E 化は専用 seed/account setup とセットで別作業 |
| Sheets 専用フォーム | `integrations-google-spreadsheets.test.ts`、`forms-integrations-google-sheets-sync-auth.test.ts`、`spreadsheet-selector.test.tsx`、`use-google-sheets-sync.test.tsx` | QA Sheet 実接続は手動。Sheet ID は `<QA_GOOGLE_SHEET_ID>` placeholder のみ docs に残し、実 ID は証跡から redaction |

## manual QA ledger template

手動 QA が必要な story は、次の欄を埋めて再実行可能にする。

| Story | 期待結果 | 証跡欄 | 失敗時の切り分け先 |
|------|----------|--------|--------------------|
| S01/S23/S24 | 全設問 submit が 200、回答詳細に各 question_id と保存値が表示される | screenshot、response ID、`GET /api/forms/:id/responses/:responseId` assertion | `FormBody` 入力なら component、保存なら `forms-public` route、validation error なら `response-validator` |
| S02/S25 | completion screen が submit UI を消し、title/message/link/contact/response ID を設定通り表示 | success screen screenshot、response ID、公開 snapshot JSON | `public-form-page` reducer、`forms-public` confirmation snapshot、post-submit settings |
| S03/S15/S26 | locked body は metadata のみ、正 password 後に本文表示、公開 snapshot 前後で state が混ざらない | locked/unlocked screenshots、verified cookie、API body diff | `forms-public` password gate、`forms-structure-password-protection`、`PasswordProtectionGate` |
| S04 | response search が committed search term だけで走り、検索中/空/error を混同しない | search term、page、selected response ID、error/empty screenshot | `form-responses-page` state、responses route search、React Query error state |
| S05 | CSV export が loading 後に CSV を保存し、API/HTML error は安全な toast になる | downloaded CSV、network status、failure toast screenshot | `ResponseExport`、CSV blob handling、`response-export` formatter |
| S06 | public URL regeneration が確認後だけ実行され、旧 URL は無効・新 URL は有効になる | old/new public URL redacted screenshot、copy action、old URL 404/403 assertion | public URL settings UI、regenerate route、rate limit |
| S07/S27 | VIEWER link は editor-only routes を拒否、EDITOR link は確認後に作成される | link role screenshot、403/404 API assertion、clipboard fallback URL | `withDualFormAuth`、share-link token role、`ShareLinkManager` |
| S08/S28 | QA Sheet に対象 response が append され、manual sync job status が same-form のみ見える | redacted Sheet screenshot、job ID、job status API assertion | Google OAuth/token、Sheets route auth、worker `sheets-sync` |
| S09 | duplicate/archive action 後に toast、遷移、一覧状態が意図通りになる | duplicate form ID、archive state screenshot、toast | duplicate/archive actions component、forms detail route |
| S10 | prefill URL が対応 question だけを含み、非対応 question は guidance に残る | generated URL、preview/public initial answers screenshot | prefill generator、`decodePrefillData`、public/preview form initial answers |
| S11 | schedule の pending/completed/failed/cancelled と retry/recovery action が区別される | scheduleId、status screenshot、copied log search key | schedule manager UI、forms schedule route、schedule processor logs |
| S12 | appearance preview と公開 snapshot で question number / color / layout が反映される | settings screenshot、public form screenshot、snapshot version | appearance route、`FormAppearanceSettings`、public `FormBody` |
| S13 | public choice / grid controls が visible label で操作でき、保存値は option ID のまま | keyboard/screen reader notes、submitted response values | choice label helpers、question node inputs、response choice labels |
| S14 | submit 完了後の低速/連打でも二重送信せず、required error が復活しない | network request count、success screen screenshot、response ID | `public-form-page` submit reducer、submit mutation state、required validation |
| S16/S17 | response ID 表示設定と notification enqueue が送信成功を阻害しない | success screen、notification job ID、channel status log without secrets | `forms-public` enqueue fail-open、`form-submit-notifications` handler、queue selection |
| S18/S29 | grid analytics と CSV が同じ回答値を表示し、invalid payload notice が過剰表示されない | analytics screenshot、CSV artifact、response set ID | `response-analytics` aggregation、chart component、CSV export formatter |
| S19 | mock provider が success/failed/rate-limited/retry を Queue/SSE/回答詳細へ反映する | validationResultId、SSE event log、answer detail screenshot | API validation outbox、Worker generic validation、plugin load dir drift |
| S20 | response detail に validation results、errorCode/errorMessage、retry/cancel 結果が表示される | response detail screenshot、validationResultId、retry API assertion | response detail view、validation result list、validation retry route |
| S21 | date required/range が page navigation を正しく止め、範囲内では進める | date input screenshot、next-page state、submitted value | date question node、`FormBody` paging、response validator |
| S22 | publish menu の snapshot/version copy が現在の公開対象を誤解させない | publish menu screenshot、target version、snapshot ID | publish menu model、snapshot copy component、snapshot history |
| S30 | すべての証跡から token、実 Sheet ID、実メール、webhook URL が redaction 済み | redaction checklist、artifact path | `e2e/README.md` QA fixture 方針、`docs/operations.md` safe QA environment |

## 完了判定

- この台帳で S01-S30 が 4 分類のいずれかに入り、S01/S02/S03/S07/S08/S14/S15/S16/S18/S23/S24/S25/S26/S27/S28 の対応済み PR、既存テスト、手動確認残りが追える。
- R24-M7 は docs-only。新規 E2E runner、依存追加、通知 enqueue/worker/service の再設計、既存機能の実装修正は行わない。
- 追加で自動化する場合は、上記 fixture inventory の「不足と次の作業単位」を 1 PR ずつ分解する。
