#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const checkEnvScript = fileURLToPath(new URL("check-env.mjs", import.meta.url));

const requiredEnv = {
  API_BASE_URL: "http://localhost:3001",
  AUTH_SECRET: "test-auth-secret",
  DATABASE_URL: "mysql://user:password@localhost:3306/nexus_form",
  DISCORD_BOT_TOKEN: "discord-bot-token",
  DISCORD_CLIENT_ID: "discord-client-id",
  DISCORD_CLIENT_SECRET: "discord-client-secret",
  GITHUB_APP_ID: "12345",
  GITHUB_PRIVATE_KEY: "github-private-key",
  GOOGLE_OAUTH_CLIENT_ID: "google-client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret",
  GOOGLE_OAUTH_ENC_KEY: "google-oauth-enc-key",
  HCAPTCHA_SECRET_KEY: "hcaptcha-secret-key",
  REDIS_URL: "redis://localhost:6379",
  S3_ACCESS_KEY_ID: "s3-access-key",
  S3_BUCKET_PROD: "prod-bucket",
  S3_BUCKET_TMP: "tmp-bucket",
  S3_ENDPOINT: "http://localhost:9000",
  S3_SECRET_ACCESS_KEY: "s3-secret-key",
  SESSION_ALIAS_SALT: "session-alias-salt",
  SIGNUP_INVITATION_CODE: "signup-code",
  TRUSTED_ORIGINS: "http://localhost:3000",
  TWITTER_BEARER_TOKEN: "twitter-bearer-token",
  VITE_API_URL: "http://localhost:3001",
  VITE_BASE_URL: "http://localhost:3000",
  VITE_HCAPTCHA_SITE_KEY: "hcaptcha-site-key",
};

function createEnvFixture(values) {
  const tempDir = mkdtempSync(join(tmpdir(), "check-env-"));
  const envPath = join(tempDir, ".env.local");
  const contents = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  writeFileSync(envPath, `${contents}\n`, "utf8");

  return {
    envPath,
    remove: () => rmSync(tempDir, { force: true, recursive: true }),
  };
}

function runCheckEnv(envPath) {
  return spawnSync(process.execPath, [checkEnvScript, "--env-file", envPath], {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
    },
  });
}

test("check-env succeeds with the minimal required env fixture", () => {
  const fixture = createEnvFixture(requiredEnv);

  try {
    const result = runCheckEnv(fixture.envPath);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
    assert.match(result.stdout, /環境変数の設定は正常です/);
  } finally {
    fixture.remove();
  }
});

test("check-env fails when required env vars are missing", () => {
  const fixture = createEnvFixture({
    ...requiredEnv,
    AUTH_SECRET: "",
  });

  try {
    const result = runCheckEnv(fixture.envPath);

    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
    assert.match(result.stdout, /AUTH_SECRET: 未設定/);
  } finally {
    fixture.remove();
  }
});
