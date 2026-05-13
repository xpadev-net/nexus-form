# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Repository Guidelines

## Communication Guidelines
- Think in English during analysis and implementation.
- When performing reviews, reporting to the user, or asking questions, communicate in Japanese.

## Project Structure & Module Organization
This repository is a **pnpm workspace monorepo** orchestrated by **Turborepo**. The workspace root defines shared tooling (`biome.json`, `tsconfig.json`, `lefthook.yml`, `turbo.json`) and delegates builds, linting, and testing to individual packages via `turbo` pipelines.

### Apps (`apps/`)
| Package | Stack | Description |
|---|---|---|
| `@nexus-form/web` | Vite + React 19 + TanStack Router | SPA フロントエンド (port 3000) |
| `@nexus-form/api` | Hono + Node.js | REST API サーバー (port 3001) |
| `@nexus-form/worker` | BullMQ + tsx | 非同期ジョブワーカー (Discord, GitHub, Twitter, Sheets) |

### Packages (`packages/`)
| Package | Description |
|---|---|
| `@nexus-form/database` | Drizzle ORM スキーマ・マイグレーション (MySQL) |
| `@nexus-form/integrations` | 外部サービス連携・プラグインレジストリ |
| `@nexus-form/shared` | 共有 zod バリデーションスキーマ・型定義 |
| `@nexus-form/validation-provider-discord` | 組み込み Discord バリデーター |
| `@nexus-form/validation-provider-github` | 組み込み GitHub バリデーター |
| `@nexus-form/validation-provider-twitter` | 組み込み Twitter バリデーター |

### Root-level legacy code (`src/`, `prisma/`)
ルート直下の `src/` と `prisma/` は旧 Next.js 単体アプリの残存コードです。新規開発は `apps/` と `packages/` 配下で行ってください。

### Key config files
- `pnpm-workspace.yaml` — ワークスペース定義 (`apps/*`, `packages/*`)
- `turbo.json` — Turborepo タスクパイプライン
- `biome.json` — リンター・フォーマッター (ルートで一元管理)
- `tsconfig.json` — ベース TypeScript 設定 (各パッケージが `extends` で継承)
- `docker-compose.yml` — MySQL, Redis, MinIO, API, Web, Worker のローカル開発環境

## Build, Test, and Development Commands
すべてのコマンドはルートから `turbo` 経由で実行します。

| Command | Description |
|---|---|
| `pnpm install` | 全ワークスペースの依存関係をインストール |
| `pnpm dev` | 全 apps を並列で開発サーバー起動 |
| `pnpm build` | 全パッケージ・アプリをビルド (`^build` 依存解決付き) |
| `pnpm lint:fix` | Biome lint + auto-fix (全ワークスペース) |
| `pnpm type-check` | TypeScript 型チェック (全ワークスペース) |
| `pnpm test` | vitest テスト実行 (全ワークスペース) |
| `pnpm db:generate` | Drizzle Kit マイグレーション生成 |
| `pnpm db:migrate` | Drizzle Kit マイグレーション適用 |

特定パッケージのみ実行する場合は `pnpm --filter <package-name> <script>` を使用してください (例: `pnpm --filter @nexus-form/api test`)。

単一テストファイルを実行する場合:
```bash
pnpm --filter @nexus-form/api exec vitest run src/__tests__/specific.test.ts
```

Before committing, run `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent` and confirm they pass. Resolve any failures, even if they appear to stem from changes outside your PR, so the shared branch stays green.

**Important**: Never use `git commit --no-verify` or `git push --no-verify` as these bypass essential quality checks. Always fix type/lint errors, even if they are not directly caused by your changes, to maintain code quality standards.

## Key Architecture Patterns

### Hono RPC Typed Client
`apps/api/src/index.ts` は `AppType` をエクスポートし、フロントエンドは `apps/web/src/lib/api.ts` で `hc<AppType>(baseUrl)` を用いて完全な型安全 API クライアントを構築します。API ルートを追加したら `AppType` の型が自動的に伝播するため、フロントエンドで型を手動管理する必要はありません。レスポンス取得には `rpc()` ヘルパーを使用し、エラー時は `RpcError` がスローされます。hono-rpc の型推論が保証するため、フロントエンド側での Zod バリデーションは不要です。

### Dual-Auth (`apps/api/src/lib/dual-auth.ts`)
API は 2 種類の認証をサポートします: (1) better-auth によるセッション Cookie 認証、(2) `Authorization: Bearer <token>` による API トークン認証。`withDualFormAuth` / `withDualAuth` ミドルウェアが両方を透過的に処理し、`DualAuthContext` として統一されたコンテキストを提供します。

### SSE と Redis Pub/Sub
フォームのリアルタイム更新 (`GET /:id/responses/events`, `GET /:id/editor/events`) は Redis Pub/Sub をバックエンドとして使用します。API サーバーは `redis-publisher.ts` でイベントを発行し、SSE エンドポイントがチャンネルをサブスクライブして `text/event-stream` でクライアントへ配信します。チャンネル名は `@nexus-form/shared` の `getValidationChannel()` / `getEditorChannel()` で生成します。

### バリデーションプラグインと BullMQ キュー
バリデーション処理は非同期: API が `getValidationQueue(providerName)` で `${providerName}-validation` キューへジョブを enqueue し、Worker が `handleGenericValidation` で処理します。外部プラグインは ESM `.mjs` をバンドル済み自己完結形式で `VALIDATION_PLUGINS_DIR` に配置します。API と Worker は起動時に同じプラグインディレクトリを読み込む必要があります（ドリフト禁止）。プラグイン追加後は両プロセスの再起動が必要です。詳細は `docs/external-plugins.md` を参照。

## Coding Style & Naming Conventions
Biome enforces two-space indentation, spaced braces, and import organization—always run it before committing. Components and hooks use PascalCase and camelCase respectively. Prefer functional React components with explicit prop types and rely on Tailwind utility classes instead of ad-hoc CSS whenever possible.

- **Web app (`apps/web`)**: ファイルは TanStack Router のルートセグメントに沿って配置。`@/` パスエイリアスは `apps/web/src` を指します。
- **API (`apps/api`)**: Hono ルートは `src/routes/` に配置。
- **Worker (`apps/worker`)**: ジョブハンドラは `src/handlers/` に配置。
- **Packages**: 各パッケージは `src/` をソースルートとし、`dist/` にビルド出力。rollup でバンドル。

## Testing Guidelines
`apps/api` と `apps/worker` は vitest でテストを実行します。テストファイルは対応する `__tests__/` フォルダに配置してください。ルートの `vitest.config.mts` はレガシーコード向けです。新規テストは各パッケージ内の `vitest.config.ts` で管理してください。

Processing speed varies widely by environment, so do not add performance tests that attempt to assert execution time—they become flaky and offer no actionable signal (処理速度計測目的のパフォーマンステストは禁止).

## Commit & Pull Request Guidelines
Follow the existing history by writing short, imperative commit subjects (e.g., `Add contact form route`). Push atomic commits that group related changes and leave formatting noise to Biome. Pull requests should describe the motivation, note affected packages/apps, link open issues, and include screenshots or clips for UI updates. Confirm linting and production build steps in the PR checklist before requesting review.

## Environment & Configuration Tips
Environment variables live in `.env.local` (git-ignored); document any new keys in the PR summary with usage notes. `docker-compose.yml` で MySQL, Redis, MinIO をローカル起動できます。Tailwind は `@tailwindcss/vite` (Web) および `@tailwindcss/postcss` (レガシー) 経由で提供されます。

## Additional Agent Rules
- Always run `pnpm lint:fix`, `pnpm type-check`, and `pnpm test --silent` before declaring a task complete, even if the changes seem small.
- Do not use watch mode for any commands. Avoid `--watch`/`--watchAll` and other interactive modes; always run commands non-interactively (e.g., `pnpm test`).
- Avoid introducing the TypeScript `any` type; prefer precise typings and add generics if necessary.
- Minimize the use of `as SomeType`; reach for type-safe patterns such as narrowing functions or helper guards instead.
- Define and validate all shared data contracts with `zod`, keeping schemas colocated with the code that consumes them when possible. Shared schemas go in `packages/shared`.
- Ensure every API request and response is checked against the relevant `zod` schema so runtime payloads stay in sync with TypeScript types.
- Escape backticks when passing long summaries or other text through command-line arguments so they can't accidentally execute as paths or commands.
- For API routes in `apps/api`, define dedicated `zod` schemas for both payloads and responses, and export the inferred response type so the frontend can reuse it via `@nexus-form/shared`.
- When a component grows unwieldy, split it into focused subcomponents to keep each file readable and maintainable.
- When you need the return value of `setTimeout` in the frontend, call `window.setTimeout` and treat the handle as a plain `number` so we never mix it up with Node.js `Timeout` objects.
- Import React helpers with named imports like `import { FC, useState } from "react";` and avoid referring to them as `React.FC` or `React.useState`.
- Use `@tanstack/react-query` for data fetching on the frontend so caching and revalidation rules stay consistent; call out and justify any exceptions.
- When someone asks you to open a pull request, create it with the `gh` CLI instead of other tooling.
- When asked to create a plan, after implementation completion, create a new branch and push the changes as a verification step to ensure the implementation is properly tracked and reviewable.
- Do not write tests whose primary purpose is to measure performance or execution time; such tests are forbidden because they are flaky and environment-dependent.
- New code should be placed in the appropriate `apps/` or `packages/` directory. Do not add new features to the root-level `src/` directory.
- When adding a dependency, install it in the correct workspace package (`pnpm --filter <package-name> add <dep>`), not at the root.

## Active Technologies
- **Runtime**: TypeScript 5.9, Node.js
- **Frontend**: Vite 7, React 19, TanStack Router, TanStack React Query, Tailwind CSS 4, Radix UI, shadcn/ui, react-hook-form
- **Backend**: Hono, better-auth, BullMQ, IORedis
- **Database**: MySQL (Drizzle ORM, drizzle-kit)
- **Integrations**: discord.js, Octokit (GitHub), axios (Twitter)
- **Validation**: zod 4
- **Tooling**: pnpm 9, Turborepo 2, Biome 2, Lefthook, Rollup, vitest
- **Infrastructure**: Docker Compose (MySQL, Redis, MinIO)
