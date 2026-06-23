import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { logWarn } from "../logger";
import { getS3Client } from "./client";

/**
 * S3バケット設定
 */
const localS3BucketFallbackEnvironments = new Set(["development", "test"]);
const s3BucketFallbacks = {
  TMP: "tmp-bucket",
  PROD: "prod-bucket",
} as const;

export interface S3BucketConfig {
  TMP: string;
  PROD: string;
}

export function validateBucketName(bucketName: string): boolean {
  // S3バケット名の検証ルール
  // - 3-63文字の長さ
  // - 小文字、数字、ハイフン、ピリオドのみ
  // - ハイフンで始まったり終わったりしない
  // - 連続するピリオドは不可
  // - ピリオドとハイフンの隣接、IPアドレス形式は不可
  const bucketNameRegex = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

  if (bucketName.length < 3 || bucketName.length > 63) {
    return false;
  }

  if (!bucketNameRegex.test(bucketName)) {
    return false;
  }

  if (bucketName.includes("..")) {
    return false;
  }

  if (bucketName.includes(".-") || bucketName.includes("-.")) {
    return false;
  }

  return !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bucketName);
}

function shouldUseLocalBucketFallback(nodeEnv: string | undefined): boolean {
  return localS3BucketFallbackEnvironments.has(nodeEnv ?? "");
}

function formatNodeEnv(nodeEnv: string | undefined): string {
  return nodeEnv && nodeEnv.length > 0 ? nodeEnv : "unset";
}

function getBucketName(
  env: NodeJS.ProcessEnv,
  nodeEnv: string | undefined,
  envVar: string,
  fallback: string,
): string {
  const value = env[envVar]?.trim();
  if (!value) {
    if (!shouldUseLocalBucketFallback(nodeEnv)) {
      throw new Error(
        `${envVar} is required when NODE_ENV is ${formatNodeEnv(nodeEnv)}. S3 bucket fallback is limited to development and test.`,
      );
    }

    logWarn("Environment variable not set, using fallback", "storage", {
      envVar,
      fallback,
      nodeEnv: formatNodeEnv(nodeEnv),
    });
    return fallback;
  }

  if (!validateBucketName(value)) {
    if (!shouldUseLocalBucketFallback(nodeEnv)) {
      throw new Error(`Invalid S3 bucket name in ${envVar}: ${value}`);
    }

    logWarn("Invalid bucket name format, using fallback", "storage", {
      envVar,
      value,
      fallback,
      nodeEnv: formatNodeEnv(nodeEnv),
    });
    return fallback;
  }

  return value;
}

export function resolveS3BucketConfig(
  env: NodeJS.ProcessEnv = process.env,
  nodeEnv: string | undefined = env.NODE_ENV,
): S3BucketConfig {
  return {
    TMP: getBucketName(env, nodeEnv, "S3_BUCKET_TMP", s3BucketFallbacks.TMP),
    PROD: getBucketName(env, nodeEnv, "S3_BUCKET_PROD", s3BucketFallbacks.PROD),
  };
}

export const S3_BUCKETS = resolveS3BucketConfig();

/**
 * Checks whether a value is a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a string property from an object-shaped error.
 */
function getStringProperty(
  value: Record<string, unknown>,
  property: string,
): string | undefined {
  const propertyValue = value[property];
  return typeof propertyValue === "string" ? propertyValue : undefined;
}

/**
 * Extracts the numeric AWS SDK HTTP status code from error metadata.
 */
function getHttpStatusCode(error: Record<string, unknown>): number | undefined {
  const metadata = error.$metadata;
  if (!isRecord(metadata)) {
    return undefined;
  }

  return typeof metadata.httpStatusCode === "number"
    ? metadata.httpStatusCode
    : undefined;
}

/**
 * Returns true only for S3 not-found responses from HeadObject.
 */
function isS3NotFoundError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  if (getHttpStatusCode(error) === 404) {
    return true;
  }

  const errorCodes = [
    getStringProperty(error, "name"),
    getStringProperty(error, "Code"),
  ];

  return errorCodes.some((code) => code === "NotFound" || code === "NoSuchKey");
}

/**
 * オブジェクトの存在確認
 * @param bucket バケット名
 * @param key オブジェクトキー
 * @returns 存在するかどうか
 */
export async function objectExists(
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await getS3Client().send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    return true;
  } catch (error) {
    if (isS3NotFoundError(error)) {
      return false;
    }

    throw error;
  }
}

/**
 * オブジェクトを取得する
 * @param bucket バケット名
 * @param key オブジェクトキー
 * @returns オブジェクトの内容
 */
export async function getObject(
  bucket: string,
  key: string,
): Promise<Uint8Array> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await getS3Client().send(command);

  if (!response.Body) {
    throw new Error("Object not found");
  }

  return await response.Body.transformToByteArray();
}

/**
 * オブジェクトをアップロードする
 * @param bucket バケット名
 * @param key オブジェクトキー
 * @param body アップロードするデータ
 * @param contentType コンテンツタイプ
 * @returns アップロード結果
 */
export async function putObject(
  bucket: string,
  key: string,
  body: Uint8Array | string,
  contentType?: string,
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await getS3Client().send(command);
}

/**
 * オブジェクトを削除する
 * @param bucket バケット名
 * @param key オブジェクトキー
 */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await getS3Client().send(command);
}

/**
 * オブジェクトを移動する（S3のCopyObjectCommandを使用してメタデータを保持）
 * @param sourceBucket ソースバケット
 * @param sourceKey ソースキー
 * @param destBucket デスティネーションバケット
 * @param destKey デスティネーションキー
 */
export async function moveObject(
  sourceBucket: string,
  sourceKey: string,
  destBucket: string,
  destKey: string,
): Promise<void> {
  // S3のCopyObjectCommandを使用してメタデータを保持しながらコピー
  const copyCommand = new CopyObjectCommand({
    CopySource: `${sourceBucket}/${encodeURIComponent(sourceKey)}`,
    Bucket: destBucket,
    Key: destKey,
  });

  await getS3Client().send(copyCommand);

  // コピーが成功したら元のオブジェクトを削除
  await deleteObject(sourceBucket, sourceKey);
}

/**
 * ファイル名からユニークなキーを生成する
 * @param originalName 元のファイル名
 * @param prefix プレフィックス（オプション）
 * @returns ユニークなキー
 */
export function generateUniqueKey(
  originalName: string,
  prefix?: string,
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const extension = originalName.split(".").pop();
  const baseName = originalName.replace(/\.[^/.]+$/, "");

  const key = `${prefix || ""}${baseName}_${timestamp}_${random}.${extension}`;
  return key.replace(/[^a-zA-Z0-9._-]/g, "_"); // 安全な文字のみ使用
}
