import { randomBytes } from "node:crypto";
import { HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { DEFAULT_IMAGE_PROCESSING_CONFIG } from "../config/image-processing";
import { withDualAuth } from "../lib/dual-auth";
import { createHonoApp } from "../lib/hono";
import { createRateLimit } from "../lib/rate-limit";
import { s3BaseService } from "../lib/s3/base-service";
import { getS3Client } from "../lib/s3/client";
import { s3ImageService as s3Service } from "../lib/s3/image-service";
import { S3_BUCKETS } from "../lib/s3/utils";
import {
  assertS3ObjectKeyPrefix,
  DEFAULT_VALIDATION_CONFIG,
  SecurityValidationError,
  validateFileExtension,
  validateFileName,
  validateFileSize,
  validateMimeType,
} from "../lib/s3/validation";

const presignedUrlSchema = z.object({
  key: z.string().min(1),
  bucket: z.string().optional(),
  expiresIn: z.number().int().positive().optional(),
  type: z.enum(["upload", "download"]).optional(),
});

const presignedUploadSchema = z.object({
  fileName: z.string().min(1),
  fileSize: z.number().int().positive(),
  mimeType: z.string().min(1),
});

const uploadCompleteSchema = z.object({
  key: z.string().min(1),
  bucket: z.string().optional(),
  size: z.number().positive(),
  contentType: z.string().min(1),
  etag: z.string().optional(),
});

const processImageSchema = z.object({
  tmpKey: z.string().min(1),
  processingConfig: z
    .object({
      maxWidth: z.number().positive().optional(),
      maxHeight: z.number().positive().optional(),
      quality: z.number().int().min(1).max(100).optional(),
      format: z.enum(["webp", "jpeg", "png"]).optional(),
    })
    .optional(),
  finalKey: z.string().optional(),
});

const moveSchema = z.object({
  tmpKey: z.string().min(1),
  finalKey: z.string().optional(),
});

const deleteSchema = z.object({
  key: z.string().min(1),
  bucket: z.string().optional(),
});

const listQuerySchema = z.object({
  bucket: z.string().optional(),
  prefix: z.string().optional(),
  maxKeys: z.coerce.number().int().positive().max(1000).optional(),
});

const PresignedUrlResultSchema = z.object({
  url: z.string().url(),
  key: z.string(),
  expiresIn: z.number().int().positive(),
});

const PresignedUrlResponseSchema = z.object({
  success: z.literal(true),
  data: PresignedUrlResultSchema,
});
export type PresignedUrlResponse = z.infer<typeof PresignedUrlResponseSchema>;

const PresignedUploadResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    presignedUrl: z.string().url(),
    key: z.string(),
    expiresIn: z.number().int().positive(),
    contentType: z.string(),
    maxFileSize: z.number().int().positive(),
  }),
});
export type PresignedUploadResponse = z.infer<
  typeof PresignedUploadResponseSchema
>;

const UploadCompleteResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    key: z.string(),
    bucket: z.string(),
    size: z.number().positive(),
    contentType: z.string(),
    etag: z.string().optional(),
    message: z.string(),
  }),
});
export type UploadCompleteResponse = z.infer<
  typeof UploadCompleteResponseSchema
>;

const UploadResultResponseSchema = z.object({
  key: z.string(),
  bucket: z.string(),
  url: z.string(),
  size: z.number().nonnegative(),
  contentType: z.string(),
});

const ProcessImageResponseSchema = z.object({
  success: z.literal(true),
  data: UploadResultResponseSchema.extend({
    message: z.string(),
  }),
});
export type ProcessImageResponse = z.infer<typeof ProcessImageResponseSchema>;

const MoveResponseSchema = z.object({
  success: z.literal(true),
  data: UploadResultResponseSchema,
});
export type MoveResponse = z.infer<typeof MoveResponseSchema>;

const DeleteResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});
export type DeleteResponse = z.infer<typeof DeleteResponseSchema>;

const ListResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    images: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        size: z.number().nonnegative(),
        lastModified: z.string().datetime().nullable(),
        url: z.string(),
      }),
    ),
    bucket: z.string(),
    prefix: z.string(),
    maxKeys: z.number().int().positive(),
    count: z.number().int().nonnegative(),
    truncated: z.boolean(),
    nextContinuationToken: z.string().optional(),
  }),
});
export type ListResponse = z.infer<typeof ListResponseSchema>;

const HealthResponseSchema = z.object({
  status: z.literal("healthy"),
  timestamp: z.string().datetime(),
  buckets: z.object({
    tmp: z.string(),
    prod: z.string(),
  }),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

const UnhealthyResponseSchema = z.object({
  status: z.literal("unhealthy"),
  error: z.string(),
  timestamp: z.string().datetime(),
});
export type UnhealthyResponse = z.infer<typeof UnhealthyResponseSchema>;

function resolveBucketName(bucket?: string): string {
  if (!bucket || bucket === "prod") return S3_BUCKETS.PROD;
  if (bucket === "tmp") return S3_BUCKETS.TMP;
  throw new Error(
    `Invalid bucket name: "${bucket}". Only "prod" and "tmp" are allowed.`,
  );
}

function s3ValidationErrorResponse(error: SecurityValidationError) {
  return {
    error: error.message,
    validationErrors: error.validationErrors,
  };
}

function assertKeyMatchesBucket(key: string, bucket: string): void {
  assertS3ObjectKeyPrefix(key, bucket === S3_BUCKETS.TMP ? "tmp/" : "prod/");
}

/**
 * key が指定ユーザーの名前空間（`tmp/users/{userId}/` または `prod/users/{userId}/`）に
 * 属するか検証する。パストラバーサル文字が含まれる場合も false を返す。
 */
function isKeyOwnedBy(userId: string, key: string): boolean {
  if (
    key.split("/").some((segment) => segment === "..") ||
    key.includes("//")
  ) {
    return false;
  }
  return (
    key.startsWith(`tmp/users/${userId}/`) ||
    key.startsWith(`prod/users/${userId}/`)
  );
}

export const s3Router = createHonoApp()
  .get(
    "/presigned-url",
    withDualAuth(),
    zValidator("query", presignedUrlSchema),
    async (c) => {
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);

      const query = c.req.valid("query");

      if (!isKeyOwnedBy(auth.user_id, query.key)) {
        return c.json({ error: "Access denied to key" }, 403);
      }

      const bucket = resolveBucketName(query.bucket);
      try {
        assertKeyMatchesBucket(query.key, bucket);
      } catch (error) {
        if (error instanceof SecurityValidationError) {
          return c.json(s3ValidationErrorResponse(error), 400);
        }
        throw error;
      }

      const expiresIn = query.expiresIn ?? 3600;
      const type = query.type ?? "download";

      const data =
        type === "upload"
          ? await s3Service.generateUploadUrl(query.key, bucket, expiresIn)
          : await s3Service.generateDownloadUrl(query.key, bucket, expiresIn);

      return c.json(PresignedUrlResponseSchema.parse({ success: true, data }));
    },
  )
  .post(
    "/presigned-upload",
    withDualAuth(),
    createRateLimit({ windowMs: 60 * 1000, maxRequests: 20 }),
    zValidator("json", presignedUploadSchema),
    async (c) => {
      try {
        const auth = c.get("dualAuthContext");
        if (!auth) return c.json({ error: "Unauthorized" }, 401);

        const { fileName, fileSize, mimeType } = c.req.valid("json");

        const fileNameValidation = validateFileName(fileName);
        if (!fileNameValidation.isValid) {
          throw new SecurityValidationError(
            "File name validation failed",
            fileNameValidation.errors,
          );
        }

        const fileSizeValidation = validateFileSize(
          fileSize,
          DEFAULT_VALIDATION_CONFIG.maxSize,
          mimeType,
          DEFAULT_VALIDATION_CONFIG.fileTypeSizeLimits,
        );
        if (!fileSizeValidation.isValid) {
          throw new SecurityValidationError(
            "File size validation failed",
            fileSizeValidation.errors,
          );
        }

        const mimeTypeValidation = validateMimeType(
          mimeType,
          DEFAULT_VALIDATION_CONFIG.allowedTypes,
        );
        if (!mimeTypeValidation.isValid) {
          throw new SecurityValidationError(
            "MIME type validation failed",
            mimeTypeValidation.errors,
          );
        }

        const extensionValidation = validateFileExtension(
          fileName,
          DEFAULT_VALIDATION_CONFIG.allowedExtensions,
        );
        if (!extensionValidation.isValid) {
          throw new SecurityValidationError(
            "File extension validation failed",
            extensionValidation.errors,
          );
        }

        if (
          mimeType === "image/svg+xml" &&
          !DEFAULT_VALIDATION_CONFIG.allowSvg
        ) {
          throw new SecurityValidationError("SVG files are not allowed", [
            "SVG files are not allowed",
          ]);
        }

        const timestamp = Date.now();
        const randomString = randomBytes(12).toString("hex");
        const fileExtension = fileName.split(".").pop()?.toLowerCase() || "";
        const uniqueKey = `tmp/users/${auth.user_id}/${timestamp}-${randomString}.${fileExtension}`;

        const presignedUrl = await s3BaseService.generatePresignedPutUrl(
          uniqueKey,
          mimeType,
          15 * 60,
        );

        return c.json(
          PresignedUploadResponseSchema.parse({
            success: true,
            data: {
              presignedUrl,
              key: uniqueKey,
              expiresIn: 15 * 60,
              contentType: mimeType,
              maxFileSize:
                DEFAULT_VALIDATION_CONFIG.fileTypeSizeLimits?.[mimeType] ||
                DEFAULT_VALIDATION_CONFIG.maxSize,
            },
          }),
        );
      } catch (error) {
        if (error instanceof SecurityValidationError) {
          return c.json(
            {
              error: error.message,
              validationErrors: error.validationErrors,
            },
            400,
          );
        }
        return c.json(
          { error: "Failed to generate presigned upload URL" },
          400,
        );
      }
    },
  )
  .post(
    "/upload-complete",
    withDualAuth(),
    createRateLimit({ windowMs: 60 * 1000, maxRequests: 30 }),
    zValidator("json", uploadCompleteSchema),
    async (c) => {
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);

      const { key, bucket, size, contentType, etag } = c.req.valid("json");

      if (!isKeyOwnedBy(auth.user_id, key)) {
        return c.json({ error: "Access denied to key" }, 403);
      }

      const resolvedBucket = resolveBucketName(bucket ?? "tmp");
      try {
        assertKeyMatchesBucket(key, resolvedBucket);
      } catch (error) {
        if (error instanceof SecurityValidationError) {
          return c.json(s3ValidationErrorResponse(error), 400);
        }
        throw error;
      }

      const exists = await s3Service.objectExists(key, resolvedBucket);
      if (!exists) {
        return c.json({ error: "File not found in S3" }, 404);
      }

      return c.json(
        UploadCompleteResponseSchema.parse({
          success: true,
          data: {
            key,
            bucket: resolvedBucket,
            size,
            contentType,
            etag,
            message: "Upload completed successfully",
          },
        }),
      );
    },
  )
  .post(
    "/process-image",
    withDualAuth(),
    createRateLimit({ windowMs: 60 * 1000, maxRequests: 10 }),
    zValidator("json", processImageSchema),
    async (c) => {
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);

      const { tmpKey, processingConfig, finalKey } = c.req.valid("json");

      if (!isKeyOwnedBy(auth.user_id, tmpKey)) {
        return c.json({ error: "Access denied to key" }, 403);
      }
      if (finalKey !== undefined && !isKeyOwnedBy(auth.user_id, finalKey)) {
        return c.json({ error: "Access denied to key" }, 403);
      }

      try {
        assertS3ObjectKeyPrefix(tmpKey, "tmp/");
        if (finalKey !== undefined) {
          assertS3ObjectKeyPrefix(finalKey, "prod/");
        }
      } catch (error) {
        if (error instanceof SecurityValidationError) {
          return c.json(s3ValidationErrorResponse(error), 400);
        }
        throw error;
      }

      const exists = await s3Service.objectExists(tmpKey, S3_BUCKETS.TMP);
      if (!exists) {
        return c.json({ error: "File not found in temporary bucket" }, 404);
      }

      try {
        const result = await s3Service.processAndMoveImage(
          tmpKey,
          {
            ...DEFAULT_IMAGE_PROCESSING_CONFIG,
            ...(processingConfig ?? {}),
          },
          finalKey,
        );

        return c.json(
          ProcessImageResponseSchema.parse({
            success: true,
            data: {
              key: result.key,
              bucket: result.bucket,
              url: result.url,
              size: result.size,
              contentType: result.contentType,
              message:
                "Image processed and moved to production bucket successfully",
            },
          }),
        );
      } catch (error) {
        if (error instanceof SecurityValidationError) {
          return c.json(s3ValidationErrorResponse(error), 400);
        }
        throw error;
      }
    },
  )
  .post(
    "/move",
    withDualAuth(),
    createRateLimit({ windowMs: 60_000, maxRequests: 20 }),
    zValidator("json", moveSchema),
    async (c) => {
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);

      const { tmpKey, finalKey } = c.req.valid("json");

      if (!isKeyOwnedBy(auth.user_id, tmpKey)) {
        return c.json({ error: "Access denied to key" }, 403);
      }
      if (finalKey !== undefined && !isKeyOwnedBy(auth.user_id, finalKey)) {
        return c.json({ error: "Access denied to key" }, 403);
      }

      try {
        assertS3ObjectKeyPrefix(tmpKey, "tmp/");
        if (finalKey !== undefined) {
          assertS3ObjectKeyPrefix(finalKey, "prod/");
        }
      } catch (error) {
        if (error instanceof SecurityValidationError) {
          return c.json(s3ValidationErrorResponse(error), 400);
        }
        throw error;
      }

      try {
        const data = await s3Service.moveToProd(tmpKey, finalKey);
        return c.json(MoveResponseSchema.parse({ success: true, data }));
      } catch (error) {
        if (error instanceof SecurityValidationError) {
          return c.json(s3ValidationErrorResponse(error), 400);
        }
        throw error;
      }
    },
  )
  .delete(
    "/delete",
    withDualAuth(),
    createRateLimit({ windowMs: 60_000, maxRequests: 20 }),
    zValidator("json", deleteSchema),
    async (c) => {
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);

      const { key, bucket } = c.req.valid("json");

      if (!isKeyOwnedBy(auth.user_id, key)) {
        return c.json({ error: "Access denied to key" }, 403);
      }

      const resolvedBucket = resolveBucketName(bucket);
      try {
        assertKeyMatchesBucket(key, resolvedBucket);
      } catch (error) {
        if (error instanceof SecurityValidationError) {
          return c.json(s3ValidationErrorResponse(error), 400);
        }
        throw error;
      }

      await s3Service.deleteObject(key, resolvedBucket);
      return c.json(
        DeleteResponseSchema.parse({
          success: true,
          message: "Object deleted successfully",
        }),
      );
    },
  )
  .get(
    "/list",
    withDualAuth(),
    createRateLimit({ windowMs: 60 * 1000, maxRequests: 30 }),
    zValidator("query", listQuerySchema),
    async (c) => {
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);

      const query = c.req.valid("query");
      const bucket = resolveBucketName(query.bucket ?? "prod");
      const bucketAlias = query.bucket === "tmp" ? "tmp" : "prod";
      const userNamespacePrefix = `${bucketAlias}/users/${auth.user_id}/`;

      let prefix: string;
      if (query.prefix !== undefined) {
        if (!isKeyOwnedBy(auth.user_id, query.prefix)) {
          return c.json({ error: "Access denied to prefix" }, 403);
        }
        prefix = query.prefix;
      } else {
        prefix = userNamespacePrefix;
      }

      const maxKeys = query.maxKeys ?? 100;

      const result = await getS3Client().send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: maxKeys,
        }),
      );

      const images = (result.Contents ?? []).map((item) => {
        const key = item.Key ?? "";
        return {
          key,
          name: key.split("/").pop() ?? key,
          size: item.Size ?? 0,
          lastModified: item.LastModified?.toISOString() ?? null,
          url: key,
        };
      });

      return c.json(
        ListResponseSchema.parse({
          success: true,
          data: {
            images,
            bucket,
            prefix,
            maxKeys,
            count: images.length,
            truncated: result.IsTruncated ?? false,
            nextContinuationToken: result.NextContinuationToken,
          },
        }),
      );
    },
  )
  .get(
    "/proxy/:bucket/:key{.+}",
    withDualAuth(),
    createRateLimit({ windowMs: 60_000, maxRequests: 60 }),
    async (c) => {
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);

      const bucketAlias = c.req.param("bucket");
      const key = c.req.param("key");

      if (bucketAlias !== "prod" && bucketAlias !== "tmp") {
        return c.json(
          { error: "Invalid bucket name. Only 'prod' and 'tmp' are allowed." },
          400,
        );
      }

      if (
        !key ||
        key.split("/").some((segment) => segment === "..") ||
        key.includes("//")
      ) {
        return c.json({ error: "Invalid key format" }, 400);
      }

      const s3Key = `${bucketAlias}/${key}`;

      if (!isKeyOwnedBy(auth.user_id, s3Key)) {
        return c.json({ error: "Access denied to key" }, 403);
      }

      const actualBucket =
        bucketAlias === "prod" ? S3_BUCKETS.PROD : S3_BUCKETS.TMP;

      const exists = await s3BaseService.objectExists(s3Key, actualBucket);
      if (!exists) {
        return c.json({ error: "Object not found" }, 404);
      }

      const presignedUrlResult = await s3BaseService.generateDownloadUrl(
        s3Key,
        actualBucket,
        3600,
      );

      return c.redirect(presignedUrlResult.url, 302);
    },
  )
  .get("/health", async (c) => {
    try {
      await getS3Client().send(
        new HeadBucketCommand({ Bucket: S3_BUCKETS.TMP }),
      );
      await getS3Client().send(
        new HeadBucketCommand({ Bucket: S3_BUCKETS.PROD }),
      );

      return c.json(
        HealthResponseSchema.parse({
          status: "healthy",
          timestamp: new Date().toISOString(),
          buckets: {
            tmp: S3_BUCKETS.TMP,
            prod: S3_BUCKETS.PROD,
          },
        }),
      );
    } catch (error) {
      return c.json(
        UnhealthyResponseSchema.parse({
          status: "unhealthy",
          error: error instanceof Error ? error.message : "Unknown error",
          timestamp: new Date().toISOString(),
        }),
        503,
      );
    }
  });
