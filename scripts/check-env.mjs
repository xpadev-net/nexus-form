#!/usr/bin/env node

/**
 * 環境変数チェックスクリプト
 * 開発環境で必要な環境変数が正しく設定されているかを確認します
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const envPath = join(scriptDir, "..", ".env.local");

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const requiredEnvVarGroups = [
  {
    label: "アプリケーション基本設定",
    vars: ["AUTH_SECRET", "TRUSTED_ORIGINS", "SIGNUP_INVITATION_CODE"],
  },
  {
    label: "フロントエンド設定",
    vars: ["VITE_API_URL", "VITE_BASE_URL", "VITE_HCAPTCHA_SITE_KEY"],
  },
  {
    label: "データベース / Redis",
    vars: ["DATABASE_URL", "REDIS_URL"],
  },
  {
    label: "Discord / GitHub / Twitter 検証プロバイダ",
    vars: [
      "DISCORD_CLIENT_ID",
      "DISCORD_CLIENT_SECRET",
      "DISCORD_BOT_TOKEN",
      "GITHUB_APP_ID",
      "GITHUB_PRIVATE_KEY",
      "TWITTER_BEARER_TOKEN",
    ],
  },
  {
    label: "Google OAuth / Sheets 連携",
    vars: [
      "API_BASE_URL",
      "GOOGLE_OAUTH_CLIENT_ID",
      "GOOGLE_OAUTH_CLIENT_SECRET",
      "GOOGLE_OAUTH_ENC_KEY",
    ],
  },
  {
    label: "S3 互換ストレージ",
    vars: [
      "S3_ENDPOINT",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_BUCKET_TMP",
      "S3_BUCKET_PROD",
    ],
  },
  {
    label: "hCaptcha / セッション",
    vars: ["HCAPTCHA_SECRET_KEY", "SESSION_ALIAS_SALT"],
  },
];

const optionalEnvVarGroups = [
  {
    label: "API / Runtime",
    vars: [
      "NODE_ENV",
      "PORT",
      "LOG_LEVEL",
      "GIT_HASH",
      "SENTRY_DSN",
      "BETTER_AUTH_SECRET",
      "API_SHUTDOWN_TIMEOUT_MS",
      "TRUSTED_PROXY_COUNT",
      "HCAPTCHA_EXPECTED_HOSTNAMES",
      "INVITE_BASE_URL",
      "S3_REGION",
    ],
  },
  {
    label: "Redis 詳細設定",
    vars: [
      "REDIS_HOST",
      "REDIS_PORT",
      "REDIS_PASSWORD",
      "REDIS_TLS",
      "REDIS_SENTINELS",
      "REDIS_SENTINEL_MASTER_NAME",
      "REDIS_SENTINEL_PASSWORD",
    ],
  },
  {
    label: "Telemetry / セキュリティ補助",
    vars: [
      "TELEMETRY_TOKEN_TTL_SEC",
      "TELEMETRY_IP_SALT",
      "SESSION_IP_SALT",
      "FORM_SECURITY_DEV_BYPASS",
      "VITE_FORM_SECURITY_DEV_BYPASS",
      "DISABLE_HCAPTCHA",
      "VITE_DISABLE_HCAPTCHA",
    ],
  },
  {
    label: "画像処理",
    vars: [
      "MAX_IMAGE_SIZE",
      "MAX_IMAGE_DIMENSION",
      "MAX_IMAGE_PIXELS",
      "IMAGE_CONCURRENT_LIMIT",
      "IMAGE_RATE_LIMIT_GLOBAL",
      "IMAGE_RATE_LIMIT_WINDOW",
      "IMAGE_RATE_LIMIT_PER_USER",
      "IMAGE_RATE_LIMIT_PER_USER_WINDOW",
      "IMAGE_RATE_LIMIT_PER_IP",
      "IMAGE_RATE_LIMIT_PER_IP_WINDOW",
    ],
  },
  {
    label: "Worker / Queue",
    vars: [
      "WORKER_QUEUES",
      "WORKER_CONCURRENCY",
      "WORKER_CONCURRENCY_DISCORD_VALIDATION",
      "WORKER_CONCURRENCY_GITHUB_VALIDATION",
      "WORKER_CONCURRENCY_TWITTER_VALIDATION",
      "WORKER_CONCURRENCY_GOOGLE_SHEETS_SYNC",
      "WORKER_SHUTDOWN_TIMEOUT_MS",
      "QUEUE_METRICS_INTERVAL",
      "QUEUE_METRICS_SAMPLE_SIZE",
      "SERVICE_MONITORING_INTERVAL",
    ],
  },
  {
    label: "Validation plugins / outbox",
    vars: [
      "VALIDATION_PLUGINS_DIR",
      "VALIDATION_PLUGINS_FAIL_FAST",
      "VALIDATION_OUTBOX_SWEEP_BATCH_SIZE",
      "VALIDATION_OUTBOX_SWEEP_STALE_MS",
      "VALIDATION_OUTBOX_SWEEP_INTERVAL_MS",
    ],
  },
  {
    label: "Provider 詳細設定",
    vars: [
      "DISCORD_REDIRECT_URI",
      "DISCORD_SCOPES",
      "DISCORD_INTENTS",
      "DISCORD_API_TIMEOUT_MS",
      "DISCORD_RETRY_ATTEMPTS",
      "DISCORD_RETRY_DELAY",
      "DISCORD_CACHE_TIMEOUT",
      "GOOGLE_OAUTH_REFRESH_TIMEOUT_MS",
      "GITHUB_INSTALLATION_ID",
      "GITHUB_CACHE_EXPIRY",
      "GITHUB_API_TIMEOUT_MS",
      "TWITTER_BASE_URL",
      "TWITTER_TIMEOUT",
      "TWITTER_API_VERSION",
    ],
  },
  {
    label: "Brand / Web runtime",
    vars: [
      "BRAND_APP_NAME",
      "BRAND_PRIMARY_COLOR",
      "BRAND_SECONDARY_COLOR",
      "BRAND_ACCENT_COLOR",
      "BRAND_COOKIE_PREFIX",
      "BRAND_USER_AGENT",
      "BRAND_HOMEPAGE_URL",
      "BRAND_MONITOR_USER_AGENT",
      "BRAND_TERMS_URL",
      "BRAND_PRIVACY_URL",
      "BRAND_COPYRIGHT",
      "VITE_BRAND_APP_NAME",
      "VITE_BRAND_PRIMARY_COLOR",
      "VITE_BRAND_SECONDARY_COLOR",
      "VITE_BRAND_ACCENT_COLOR",
      "VITE_BRAND_TERMS_URL",
      "VITE_BRAND_PRIVACY_URL",
      "VITE_BRAND_COPYRIGHT",
      "VITE_BRAND_HOMEPAGE_URL",
      "VITE_TELEMETRY_HOST",
      "VITE_TELEMETRY_V4_HOST",
      "VITE_TELEMETRY_V6_HOST",
    ],
  },
];

const securityBypassEnvVars = new Set([
  "FORM_SECURITY_DEV_BYPASS",
  "VITE_FORM_SECURITY_DEV_BYPASS",
  "DISABLE_HCAPTCHA",
  "VITE_DISABLE_HCAPTCHA",
]);

console.log("🔍 環境変数チェックを開始します...\n");

let hasErrors = false;

// 必須環境変数のチェック
console.log("📋 必須環境変数のチェック:");
for (const group of requiredEnvVarGroups) {
  console.log(`\n  ${group.label}:`);
  for (const envVar of group.vars) {
    if (process.env[envVar]) {
      console.log(`  ✅ ${envVar}: 設定済み`);
    } else {
      console.log(`  ❌ ${envVar}: 未設定`);
      hasErrors = true;
    }
  }
}

console.log("\n📋 オプション環境変数のチェック:");
for (const group of optionalEnvVarGroups) {
  console.log(`\n  ${group.label}:`);
  for (const envVar of group.vars) {
    if (process.env[envVar]) {
      if (securityBypassEnvVars.has(envVar)) {
        console.log(`  ⚠️  ${envVar}: 設定済み (開発環境以外では無効化してください)`);
      } else {
        console.log(`  ✅ ${envVar}: 設定済み`);
      }
    } else {
      if (envVar === "SESSION_IP_SALT" || envVar === "TELEMETRY_IP_SALT") {
        console.log(
          `  ⚠️  ${envVar}: 未設定 (AUTH_SECRETから導出されたソルトを使用)`,
        );
      } else {
        console.log(`  ⚠️  ${envVar}: 未設定 (オプション)`);
      }
    }
  }
}

console.log("\n📋 フロントエンド接続情報:");
if (process.env.VITE_API_URL && process.env.VITE_BASE_URL) {
  try {
    const apiUrlObj = new URL(process.env.VITE_API_URL);
    const appUrlObj = new URL(process.env.VITE_BASE_URL);
    console.log(`✅ API URL: ${apiUrlObj.origin}`);
    console.log(`✅ App URL: ${appUrlObj.origin}`);
  } catch (e) {
    console.log("❌ VITE_API_URL または VITE_BASE_URL の形式が不正です");
    console.log(`   エラー: ${e.message}`);
    hasErrors = true;
  }
} else {
  console.log("❌ フロントエンド接続情報が不完全です");
  hasErrors = true;
}

console.log("\n📋 データベース接続情報:");
if (process.env.DATABASE_URL) {
  try {
    const dbUrlObj = new URL(process.env.DATABASE_URL);
    const user = dbUrlObj.username || "(not set)";
    const host = dbUrlObj.hostname || "(not set)";
    const port = dbUrlObj.port || "(not set)";
    const database = dbUrlObj.pathname
      ? dbUrlObj.pathname.replace(/^\//, "")
      : "(not set)";
    const protocol = dbUrlObj.protocol.replace(":", "");

    console.log(`✅ データベース種別: ${protocol}`);
    console.log(`✅ データベース: ${database}`);
    console.log(`✅ ホスト: ${host}:${port}`);
    console.log(`✅ ユーザー: ${user}`);
  } catch (e) {
    console.log("❌ DATABASE_URLの形式が正しくありません");
    console.log(`   エラー: ${e.message}`);
    hasErrors = true;
  }
}

console.log("\n📋 Redis接続情報:");
if (process.env.REDIS_URL) {
  try {
    const redisUrlObj = new URL(process.env.REDIS_URL);
    const host = redisUrlObj.hostname || "(not set)";
    const port = redisUrlObj.port || "(not set)";
    console.log(`✅ Redis: ${host}:${port} に接続設定済み`);
  } catch (e) {
    console.log("❌ REDIS_URLの形式が正しくありません");
    console.log(`   エラー: ${e.message}`);
    hasErrors = true;
  }
}

console.log("\n📋 Google OAuth / Sheets 連携情報:");
if (
  process.env.API_BASE_URL &&
  process.env.GOOGLE_OAUTH_CLIENT_ID &&
  process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
  process.env.GOOGLE_OAUTH_ENC_KEY
) {
  try {
    const apiBaseUrlObj = new URL(process.env.API_BASE_URL);
    console.log(`✅ Google OAuth callback origin: ${apiBaseUrlObj.origin}`);
    console.log("✅ Google OAuth client: 設定済み");
    console.log("✅ Google OAuth encryption key: 設定済み");
  } catch (e) {
    console.log("❌ API_BASE_URL の形式が不正です");
    console.log(`   エラー: ${e.message}`);
    hasErrors = true;
  }
}

console.log("\n📋 S3設定情報:");
if (
  process.env.S3_ENDPOINT &&
  process.env.S3_ACCESS_KEY_ID &&
  process.env.S3_SECRET_ACCESS_KEY
) {
  try {
    const s3UrlObj = new URL(process.env.S3_ENDPOINT);
    const host = s3UrlObj.hostname || "(not set)";
    const port = s3UrlObj.port || "(not set)";
    console.log(`✅ S3 エンドポイント: ${host}:${port}`);
    console.log(`✅ アクセスキー: 設定済み`);
    console.log(`✅ バケット (tmp): ${process.env.S3_BUCKET_TMP}`);
    console.log(`✅ バケット (prod): ${process.env.S3_BUCKET_PROD}`);
  } catch (e) {
    console.log("❌ S3_ENDPOINTの形式が不正です");
    console.log(`   エラー: ${e.message}`);
    hasErrors = true;
  }
} else {
  console.log("❌ S3設定が不完全です");
  hasErrors = true;
}

console.log("\n📋 Discord設定情報:");
if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  console.log(`✅ Discord Client ID: 設定済み`);
  console.log(`✅ Discord Client Secret: 設定済み`);
} else {
  console.log("❌ Discord OAuth設定が不完全です");
  hasErrors = true;
}

if (process.env.DISCORD_BOT_TOKEN) {
  console.log(`✅ Discord Bot Token: 設定済み`);
} else {
  console.log("❌ Discord Bot Token: 未設定 (必須)");
  hasErrors = true;
}

console.log(`\n${"=".repeat(50)}`);

if (hasErrors) {
  console.log("❌ 環境変数の設定に問題があります。");
  console.log(
    "📝 .env.local ファイルを確認し、必要な環境変数を設定してください。",
  );
  console.log("📖 詳細は .env.example ファイルを参照してください。");
  process.exit(1);
} else {
  console.log("✅ 環境変数の設定は正常です！");
  console.log("🚀 開発環境の準備が完了しました。");
  process.exit(0);
}
