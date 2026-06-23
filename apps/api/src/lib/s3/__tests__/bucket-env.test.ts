import { describe, expect, it } from "vitest";
import { resolveS3BucketConfig, validateBucketName } from "../utils";

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

  it("validates bucket names consistently", () => {
    expect(validateBucketName("nexus-form-prod")).toBe(true);
    expect(validateBucketName("Invalid_Bucket")).toBe(false);
    expect(validateBucketName("bad..bucket")).toBe(false);
    expect(validateBucketName("bad.-bucket")).toBe(false);
    expect(validateBucketName("127.0.0.1")).toBe(false);
  });
});
