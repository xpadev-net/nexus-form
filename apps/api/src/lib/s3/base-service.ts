import type {
  FileUploadConfig,
  PresignedUrlResult,
  UploadResult,
} from "../../types/s3";
import { S3Error } from "../../types/s3";
import { logError, logInfo, logWarn } from "../logger";
import { generatePresignedUploadUrl, generatePresignedUrl } from "./client";
import {
  deleteObject,
  generateUniqueKey,
  getObject,
  moveObject,
  objectExists,
  putObject,
  S3_BUCKETS,
} from "./utils";
import { assertS3ObjectKeyPrefix, SecurityValidationError } from "./validation";

/**
 * S3基本サービスクラス
 * sharpに依存しない基本機能を提供
 */
export class S3BaseService {
  protected readonly tmpBucket: string;
  protected readonly prodBucket: string;

  constructor() {
    this.tmpBucket = S3_BUCKETS.TMP;
    this.prodBucket = S3_BUCKETS.PROD;
  }

  /**
   * 一時バケットにファイルをアップロードする
   * @param file アップロードするファイル
   * @param config アップロード設定
   * @returns アップロード結果
   */
  async uploadToTmp(
    file: File,
    config: FileUploadConfig,
  ): Promise<UploadResult> {
    // ファイルサイズチェック
    if (file.size > config.maxSize) {
      throw new S3Error(
        `File size exceeds maximum allowed size of ${config.maxSize} bytes`,
      );
    }

    // ファイルタイプチェック
    if (!config.allowedTypes.includes(file.type)) {
      throw new S3Error(`File type ${file.type} is not allowed`);
    }

    // ユニークなキーを生成
    const key = generateUniqueKey(file.name, "tmp/");

    // ファイルをArrayBufferに変換
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // 一時バケットにアップロード
    await putObject(this.tmpBucket, key, uint8Array, file.type);

    return {
      key,
      bucket: this.tmpBucket,
      url: `/${this.tmpBucket}/${key}`, // 開発環境用のURL
      size: file.size,
      contentType: file.type,
    };
  }

  /**
   * 本番バケットにファイルを移動する
   * @param tmpKey 一時バケットのキー
   * @param finalKey 最終的なキー（オプション）
   * @returns 移動結果
   */
  async moveToProd(tmpKey: string, finalKey?: string): Promise<UploadResult> {
    assertS3ObjectKeyPrefix(tmpKey, "tmp/");
    const prodKey = finalKey || tmpKey.replace("tmp/", "prod/");
    assertS3ObjectKeyPrefix(prodKey, "prod/");

    // 一時バケットから本番バケットに移動
    await moveObject(this.tmpBucket, tmpKey, this.prodBucket, prodKey);

    return {
      key: prodKey,
      bucket: this.prodBucket,
      url: `/${this.prodBucket}/${prodKey}`, // 開発環境用のURL
      size: 0, // サイズは別途取得が必要
      contentType: "", // コンテンツタイプは別途取得が必要
    };
  }

  /**
   * プリサインドURLを生成する（ダウンロード用）
   * @param key オブジェクトキー
   * @param bucket バケット名（デフォルト: 本番バケット）
   * @param expiresIn 有効期限（秒）
   * @returns プリサインドURL
   */
  async generateDownloadUrl(
    key: string,
    bucket: string = this.prodBucket,
    expiresIn: number = 3600,
  ): Promise<PresignedUrlResult> {
    assertS3ObjectKeyPrefix(key, bucket === this.tmpBucket ? "tmp/" : "prod/");
    const url = await generatePresignedUrl(bucket, key, expiresIn);

    return {
      url,
      key,
      expiresIn,
    };
  }

  /**
   * プリサインドURLを生成する（アップロード用）
   * @param key オブジェクトキー
   * @param bucket バケット名（デフォルト: 一時バケット）
   * @param expiresIn 有効期限（秒）
   * @returns プリサインドURL
   */
  async generateUploadUrl(
    key: string,
    bucket: string = this.tmpBucket,
    expiresIn: number = 3600,
  ): Promise<PresignedUrlResult> {
    assertS3ObjectKeyPrefix(key, bucket === this.tmpBucket ? "tmp/" : "prod/");
    const url = await generatePresignedUploadUrl(bucket, key, expiresIn);

    return {
      url,
      key,
      expiresIn,
    };
  }

  /**
   * プリサインドPUT URLを生成する（直接アップロード用）
   * @param key オブジェクトキー
   * @param contentType コンテンツタイプ
   * @param expiresIn 有効期限（秒）
   * @param bucket バケット名（デフォルト: 一時バケット）
   * @returns プリサインドPUT URL
   */
  async generatePresignedPutUrl(
    key: string,
    contentType: string,
    expiresIn: number = 900, // 15分
    bucket: string = this.tmpBucket,
  ): Promise<string> {
    assertS3ObjectKeyPrefix(key, bucket === this.tmpBucket ? "tmp/" : "prod/");
    const url = await generatePresignedUploadUrl(
      bucket,
      key,
      expiresIn,
      contentType,
    );
    return url;
  }

  /**
   * オブジェクトを削除する
   * @param key オブジェクトキー
   * @param bucket バケット名（デフォルト: 本番バケット）
   */
  async deleteObject(
    key: string,
    bucket: string = this.prodBucket,
  ): Promise<void> {
    assertS3ObjectKeyPrefix(key, bucket === this.tmpBucket ? "tmp/" : "prod/");
    await deleteObject(bucket, key);
  }

  /**
   * オブジェクトを安全に削除する（バックアップ戦略付き）
   * @param key オブジェクトキー
   * @param bucket バケット名
   * @param backupKey バックアップキー（オプション）
   */
  async safeDeleteObject(
    key: string,
    bucket: string,
    backupKey?: string,
  ): Promise<void> {
    assertS3ObjectKeyPrefix(key, bucket === this.tmpBucket ? "tmp/" : "prod/");
    const prodKey =
      bucket === this.tmpBucket
        ? backupKey || key.replace("tmp/", "prod/")
        : undefined;
    if (prodKey !== undefined) {
      assertS3ObjectKeyPrefix(prodKey, "prod/");
    }

    try {
      // 本番バケットにファイルが存在することを確認してから削除
      if (bucket === this.tmpBucket && prodKey !== undefined) {
        const prodExists = await this.objectExists(prodKey, this.prodBucket);

        if (!prodExists) {
          logWarn(
            "Production file not found, skipping deletion to prevent data loss",
            "storage",
            { key, prodKey },
          );
          return;
        }
      }

      await deleteObject(bucket, key);
      logInfo("Successfully deleted object", "storage", { key, bucket });
    } catch (error) {
      if (error instanceof SecurityValidationError) {
        throw error;
      }
      logError("Failed to delete object", "storage", { key, bucket, error });
      // 削除失敗は警告のみ（データ損失を防ぐため）
      throw new S3Error(
        `Failed to delete object: ${error instanceof Error ? error.message : "Unknown error"}`,
        "DELETE_FAILED",
      );
    }
  }

  /**
   * オブジェクトの存在確認
   * @param key オブジェクトキー
   * @param bucket バケット名（デフォルト: 本番バケット）
   * @returns 存在するかどうか
   */
  async objectExists(
    key: string,
    bucket: string = this.prodBucket,
  ): Promise<boolean> {
    return await objectExists(bucket, key);
  }

  /**
   * オブジェクトを取得する
   * @param key オブジェクトキー
   * @param bucket バケット名（デフォルト: 本番バケット）
   * @returns オブジェクトの内容
   */
  async getObject(
    key: string,
    bucket: string = this.prodBucket,
  ): Promise<Uint8Array> {
    return await getObject(bucket, key);
  }
}

/**
 * グローバルS3基本サービスインスタンス
 */
export const s3BaseService = new S3BaseService();
