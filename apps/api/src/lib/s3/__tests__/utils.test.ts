import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { objectExists } from "../utils";

const sendMock = vi.fn();

vi.mock("../client", () => ({
  getS3Client: () => ({
    send: sendMock,
  }),
}));

describe("S3 utils", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  describe("objectExists", () => {
    it("returns true when HeadObject succeeds", async () => {
      sendMock.mockResolvedValueOnce({});

      await expect(objectExists("prod-bucket", "prod/file.png")).resolves.toBe(
        true,
      );
      expect(sendMock).toHaveBeenCalledWith(expect.any(HeadObjectCommand));
    });

    it("returns false for a 404 HeadObject response", async () => {
      sendMock.mockRejectedValueOnce({
        $metadata: { httpStatusCode: 404 },
      });

      await expect(
        objectExists("prod-bucket", "prod/missing.png"),
      ).resolves.toBe(false);
    });

    it("returns false for AWS NotFound error names", async () => {
      sendMock.mockRejectedValueOnce({ name: "NotFound" });

      await expect(
        objectExists("prod-bucket", "prod/missing.png"),
      ).resolves.toBe(false);
    });

    it("returns false for S3 not found error codes", async () => {
      sendMock.mockRejectedValueOnce({ Code: "NoSuchKey" });

      await expect(
        objectExists("prod-bucket", "prod/missing.png"),
      ).resolves.toBe(false);
    });

    it("returns false for S3 NotFound error codes", async () => {
      sendMock.mockRejectedValueOnce({ Code: "NotFound" });

      await expect(
        objectExists("prod-bucket", "prod/missing.png"),
      ).resolves.toBe(false);
    });

    it("rethrows errors with malformed metadata", async () => {
      const error = { $metadata: "not metadata" };
      sendMock.mockRejectedValueOnce(error);

      await expect(objectExists("prod-bucket", "prod/file.png")).rejects.toBe(
        error,
      );
    });

    it("rethrows null and primitive errors", async () => {
      sendMock.mockRejectedValueOnce(null);
      await expect(
        objectExists("prod-bucket", "prod/file.png"),
      ).rejects.toBeNull();

      sendMock.mockRejectedValueOnce("error");
      await expect(objectExists("prod-bucket", "prod/file.png")).rejects.toBe(
        "error",
      );
    });

    it("rethrows non-404 S3 errors", async () => {
      const error = new Error("S3 credentials are invalid");
      sendMock.mockRejectedValueOnce(error);

      await expect(objectExists("prod-bucket", "prod/file.png")).rejects.toBe(
        error,
      );
    });

    it("rethrows network errors without metadata", async () => {
      const error = Object.assign(new Error("socket hang up"), {
        code: "ECONNRESET",
      });
      sendMock.mockRejectedValueOnce(error);

      await expect(objectExists("prod-bucket", "prod/file.png")).rejects.toBe(
        error,
      );
    });
  });
});
