import { describe, expect, it, vi } from "vitest";
import { S3BaseService } from "../base-service";
import { generatePresignedUploadUrl, generatePresignedUrl } from "../client";
import { S3ImageService } from "../image-service";
import { S3_BUCKETS } from "../utils";
import { validateS3ObjectKey } from "../validation";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://s3.example.com/signed"),
}));

vi.mock("../client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client")>();
  return {
    ...actual,
    getS3Client: vi.fn(() => ({})),
  };
});

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils")>();
  return {
    ...actual,
    moveObject: vi.fn(),
  };
});

describe("S3 object key validation", () => {
  it("accepts tmp and prod object keys", () => {
    expect(validateS3ObjectKey("tmp/users/user-1/file.png")).toMatchObject({
      isValid: true,
    });
    expect(validateS3ObjectKey("prod/users/user-1/file.png")).toMatchObject({
      isValid: true,
    });
    expect(
      validateS3ObjectKey("prod/users/user-1/file..backup.png"),
    ).toMatchObject({
      isValid: true,
    });
  });

  it("rejects traversal and missing namespace prefixes", () => {
    expect(validateS3ObjectKey("tmp/users/user-1/../file.png")).toMatchObject({
      isValid: false,
    });
    expect(validateS3ObjectKey("users/user-1/file.png")).toMatchObject({
      isValid: false,
    });
  });

  it("rejects invalid download presigned keys before signing", async () => {
    await expect(
      generatePresignedUrl("prod-bucket", "prod/../other-tenant/file.png"),
    ).rejects.toThrow("Object key validation failed");
  });

  it("rejects invalid upload presigned keys before signing", async () => {
    await expect(
      generatePresignedUploadUrl("tmp-bucket", "other/file.png"),
    ).rejects.toThrow("Object key validation failed");
  });

  it("requires moveToProd source and destination prefixes", async () => {
    const service = new S3BaseService();

    await expect(
      service.moveToProd("prod/users/user-1/file.png"),
    ).rejects.toThrow("Object key must start with tmp/");
    await expect(
      service.moveToProd(
        "tmp/users/user-1/file.png",
        "tmp/users/user-1/file.png",
      ),
    ).rejects.toThrow("Object key must start with prod/");
  });

  it("requires presigned key prefixes to match the target bucket", async () => {
    const service = new S3BaseService();

    await expect(
      service.generateDownloadUrl("tmp/users/user-1/file.png", S3_BUCKETS.PROD),
    ).rejects.toThrow("Object key must start with prod/");
    await expect(
      service.generateUploadUrl("prod/users/user-1/file.png", S3_BUCKETS.TMP),
    ).rejects.toThrow("Object key must start with tmp/");
    await expect(
      service.deleteObject("tmp/users/user-1/file.png", S3_BUCKETS.PROD),
    ).rejects.toThrow("Object key must start with prod/");
  });

  it("requires processAndMoveImage source and destination prefixes", async () => {
    const service = new S3ImageService();

    await expect(
      service.processAndMoveImage("prod/users/user-1/file.png", {}),
    ).rejects.toThrow("Object key must start with tmp/");
    await expect(
      service.processAndMoveImage(
        "tmp/users/user-1/file.png",
        {},
        "tmp/users/user-1/file.png",
      ),
    ).rejects.toThrow("Object key must start with prod/");
  });
});
