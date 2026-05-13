import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * S3クライアントの設定
 * S3互換ストレージを使用。S3_ENDPOINTが設定されている場合はカスタムエンドポイント、未設定の場合はAWS S3を使用
 */
export function createS3Client(): S3Client {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const region = process.env.S3_REGION || "ap-northeast-1";

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 credentials (S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) are not configured",
    );
  }

  const config = {
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  };

  // S3_ENDPOINTが設定されている場合のみendpointとforcePathStyleを追加
  if (endpoint) {
    return new S3Client({
      ...config,
      endpoint,
      forcePathStyle: true, // MinIOやS3互換ストレージ用
    });
  }

  // AWS S3の場合（endpointなし）
  return new S3Client(config);
}

/**
 * グローバルS3クライアントインスタンス（遅延初期化）
 */
let _s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!_s3Client) {
    _s3Client = createS3Client();
  }
  return _s3Client;
}

/**
 * プリサインドURLを生成する
 * @param bucket バケット名
 * @param key オブジェクトキー
 * @param expiresIn 有効期限（秒）
 * @returns プリサインドURL
 */
export async function generatePresignedUrl(
  bucket: string,
  key: string,
  expiresIn: number = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return await getSignedUrl(getS3Client(), command, { expiresIn });
}

/**
 * アップロード用のプリサインドURLを生成する
 * @param bucket バケット名
 * @param key オブジェクトキー
 * @param expiresIn 有効期限（秒）
 * @param contentType コンテンツタイプ（オプション）
 * @returns プリサインドURL
 */
export async function generatePresignedUploadUrl(
  bucket: string,
  key: string,
  expiresIn: number = 3600,
  contentType?: string,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  return await getSignedUrl(getS3Client(), command, { expiresIn });
}
