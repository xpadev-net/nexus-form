#!/usr/bin/env node

/**
 * 環境変数チェックスクリプト
 * 開発環境で必要な環境変数が正しく設定されているかを確認します
 */

// dotenvパッケージを使用して安全に.env.localファイルを読み込む
const dotenv = require("dotenv");
const fs = require("node:fs");
const path = require("node:path");

const envPath = path.join(__dirname, "..", ".env.local");

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const requiredEnvVars = [
  "NEXTAUTH_URL",
  "AUTH_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET_TMP",
  "S3_BUCKET_PROD",
  "DISCORD_BOT_TOKEN",
  "CSRF_SECRET",
  "SESSION_ALIAS_SALT",
  "GITHUB_APP_ID",
  "GITHUB_PRIVATE_KEY",
  "TWITTER_BEARER_TOKEN",
];

const optionalEnvVars = [
  "SENTRY_DSN",
  "NODE_ENV",
  "DEBUG",
  "LOG_LEVEL",
  "ENABLE_FINGERPRINT_COLLECTION",
  "DATA_RETENTION_DAYS",
  "EXTERNAL_SERVICE_CACHE_TTL",
  "MAX_FILE_SIZE_MB",
  "ALLOWED_IMAGE_TYPES",
  "DEFAULT_TIMEZONE",
  "NEXT_PUBLIC_TELEMETRY_V4_HOST",
  "NEXT_PUBLIC_TELEMETRY_V6_HOST",
  "TELEMETRY_TOKEN_TTL_SEC",
  "TELEMETRY_IP_SALT",
  "SESSION_IP_SALT", // 未設定の場合はAUTH_SECRETから導出されたソルトを使用
];

console.log("🔍 環境変数チェックを開始します...\n");

let hasErrors = false;

// 必須環境変数のチェック
console.log("📋 必須環境変数のチェック:");
requiredEnvVars.forEach((envVar) => {
  if (process.env[envVar]) {
    console.log(`✅ ${envVar}: 設定済み`);
  } else {
    console.log(`❌ ${envVar}: 未設定`);
    hasErrors = true;
  }
});

console.log("\n📋 オプション環境変数のチェック:");
optionalEnvVars.forEach((envVar) => {
  if (process.env[envVar]) {
    console.log(`✅ ${envVar}: 設定済み`);
  } else {
    if (envVar === "SESSION_IP_SALT") {
      console.log(
        `⚠️  ${envVar}: 未設定 (AUTH_SECRETから導出されたソルトを使用)`,
      );
    } else {
      console.log(`⚠️  ${envVar}: 未設定 (オプション)`);
    }
  }
});

console.log("\n📋 データベース接続情報:");
if (process.env.DATABASE_URL) {
  try {
    const dbUrlObj = new URL(process.env.DATABASE_URL);
    const user = dbUrlObj.username || "(not set)";
    const host = dbUrlObj.hostname || "(not set)";
    const port = dbUrlObj.port || "(not set)";
    // パス名の先頭のスラッシュを削除してデータベース名を取得
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
