import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveS3BucketConfig } from "../lib/s3/utils";

const repoRoot = resolve(import.meta.dirname, "../../../..");

describe("load-env S3 bucket validation", () => {
  it("validates S3 buckets after synchronous dotenv loading", () => {
    const source = readFileSync(
      resolve(repoRoot, "apps/api/src/load-env.ts"),
      "utf8",
    );
    const callExpressions = Array.from(
      source.matchAll(/^([a-zA-Z0-9_$]+)\(/gm),
    ).map((match) => match[1]);

    expect(callExpressions).toEqual([
      "loadEnvFileSync",
      "assertS3BucketEnvironment",
    ]);
  });

  it("documents that local fallback is limited to development and test", () => {
    const loadEnvSource = readFileSync(
      resolve(repoRoot, "apps/api/src/load-env.ts"),
      "utf8",
    );
    const utilsSource = readFileSync(
      resolve(repoRoot, "apps/api/src/lib/s3/utils.ts"),
      "utf8",
    );

    expect(loadEnvSource).toContain('process.env.NODE_ENV !== "production"');
    expect(utilsSource).toContain('"development", "test"');
    expect(utilsSource).toContain("S3_BUCKET_TMP");
    expect(utilsSource).toContain("S3_BUCKET_PROD");
    expect(utilsSource).toContain(
      "S3 bucket fallback is limited to development and test",
    );
  });

  it("fails fast for missing and invalid bucket env outside local/test", () => {
    expect(() =>
      resolveS3BucketConfig({
        NODE_ENV: "production",
        S3_BUCKET_PROD: "nexus-form-prod",
      }),
    ).toThrow(/S3_BUCKET_TMP is required/);

    expect(() =>
      resolveS3BucketConfig({
        NODE_ENV: "production",
        S3_BUCKET_TMP: "Invalid_Bucket",
        S3_BUCKET_PROD: "nexus-form-prod",
      }),
    ).toThrow(/Invalid S3 bucket name in S3_BUCKET_TMP/);
  });
});
