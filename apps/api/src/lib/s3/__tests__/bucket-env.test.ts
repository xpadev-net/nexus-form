import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveS3BucketConfig, validateBucketName } from "../utils";

const originalNodeEnv = process.env.NODE_ENV;
const originalTmpBucket = process.env.S3_BUCKET_TMP;
const originalProdBucket = process.env.S3_BUCKET_PROD;

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

afterEach(() => {
  restoreEnvValue("NODE_ENV", originalNodeEnv);
  restoreEnvValue("S3_BUCKET_TMP", originalTmpBucket);
  restoreEnvValue("S3_BUCKET_PROD", originalProdBucket);
  vi.resetModules();
});

describe("S3 bucket environment", () => {
  it("allows explicit development fallback for missing buckets", () => {
    expect(resolveS3BucketConfig({ NODE_ENV: "development" })).toEqual({
      TMP: "tmp-bucket",
      PROD: "prod-bucket",
    });
  });

  it("allows explicit test fallback for invalid buckets", () => {
    expect(
      resolveS3BucketConfig({
        NODE_ENV: "test",
        S3_BUCKET_TMP: "Invalid_Bucket",
        S3_BUCKET_PROD: "Invalid_Bucket",
      }),
    ).toEqual({
      TMP: "tmp-bucket",
      PROD: "prod-bucket",
    });
  });

  it("requires production bucket environment variables", () => {
    expect(() =>
      resolveS3BucketConfig({
        NODE_ENV: "production",
        S3_BUCKET_PROD: "nexus-form-prod",
      }),
    ).toThrow(/S3_BUCKET_TMP is required/);
  });

  it("rejects invalid production bucket names", () => {
    expect(() =>
      resolveS3BucketConfig({
        NODE_ENV: "production",
        S3_BUCKET_TMP: "Invalid_Bucket",
        S3_BUCKET_PROD: "nexus-form-prod",
      }),
    ).toThrow(/Invalid S3 bucket name in S3_BUCKET_TMP/);
  });

  it("does not resolve unset buckets when the shared service is imported", async () => {
    vi.resetModules();
    delete process.env.NODE_ENV;
    delete process.env.S3_BUCKET_TMP;
    delete process.env.S3_BUCKET_PROD;

    const { s3BaseService } = await import("../base-service");

    await expect(
      s3BaseService.generateDownloadUrl("prod/users/user-1/file.png"),
    ).rejects.toThrow(/S3_BUCKET_TMP is required when NODE_ENV is unset/);
  });

  it("validates bucket names consistently", () => {
    expect(validateBucketName("nexus-form-prod")).toBe(true);
    expect(validateBucketName("Invalid_Bucket")).toBe(false);
    expect(validateBucketName("bad..bucket")).toBe(false);
    expect(validateBucketName("bad.-bucket")).toBe(false);
    expect(validateBucketName("127.0.0.1")).toBe(false);
  });
});
