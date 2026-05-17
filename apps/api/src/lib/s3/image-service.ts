import sharp from "sharp";
import { IMAGE_PROCESSING_LIMITS } from "../../config/image-processing";
import type { ImageProcessingConfig, UploadResult } from "../../types/s3";
import { S3Error } from "../../types/s3";
import { logWarn } from "../logger";
import { S3BaseService } from "./base-service";
import { putObject } from "./utils";
import { assertS3ObjectKeyPrefix, SecurityValidationError } from "./validation";

/**
 * S3画像処理サービスクラス
 * sharpに依存する画像処理機能を提供
 */
export class S3ImageService extends S3BaseService {
  /**
   * 画像処理設定に基づいて画像を処理する
   * @param imageData 画像データ
   * @param config 画像処理設定
   * @returns 処理された画像データ
   */
  async processImage(
    imageData: Uint8Array,
    config: ImageProcessingConfig,
  ): Promise<Uint8Array> {
    let sharpInstance: sharp.Sharp | null = null;

    try {
      // ファイルサイズ制限チェック
      if (imageData.length > IMAGE_PROCESSING_LIMITS.MAX_FILE_SIZE) {
        throw new S3Error(
          `File size exceeds limit of ${IMAGE_PROCESSING_LIMITS.MAX_FILE_SIZE / (1024 * 1024)}MB`,
          "FILE_TOO_LARGE",
        );
      }

      // 画像メタデータを取得してフォーマットを検証
      const metadata = await sharp(imageData).metadata();
      const supportedFormats = ["jpeg", "png", "webp"];

      if (!metadata.format || !supportedFormats.includes(metadata.format)) {
        throw new S3Error(
          `Unsupported image format: ${metadata.format || "unknown"}. Supported formats: ${supportedFormats.join(", ")}`,
          "INVALID_FORMAT",
        );
      }

      // 画像の寸法制限チェック
      if (metadata.width && metadata.height) {
        if (
          metadata.width > IMAGE_PROCESSING_LIMITS.MAX_DIMENSION ||
          metadata.height > IMAGE_PROCESSING_LIMITS.MAX_DIMENSION
        ) {
          throw new S3Error(
            `Image dimensions exceed limit of ${IMAGE_PROCESSING_LIMITS.MAX_DIMENSION}x${IMAGE_PROCESSING_LIMITS.MAX_DIMENSION}`,
            "IMAGE_TOO_LARGE",
          );
        }
      }

      // Sharpインスタンスを作成（メモリ制限付き）
      sharpInstance = sharp(imageData, {
        // メモリ使用量を制限
        limitInputPixels: IMAGE_PROCESSING_LIMITS.MAX_PIXELS,
        sequentialRead: true, // メモリ効率を向上
      });

      // リサイズ処理
      if (config.maxWidth || config.maxHeight) {
        sharpInstance = sharpInstance.resize(
          config.maxWidth,
          config.maxHeight,
          {
            fit: "inside",
            withoutEnlargement: true,
            // メモリ効率を向上させる設定
            kernel: sharp.kernel.lanczos3,
          },
        );
      }

      // フォーマット変換とクオリティ設定
      if (config.format === "webp") {
        sharpInstance = sharpInstance.webp({
          quality: config.quality || 80,
        });
      } else if (config.format === "jpeg") {
        sharpInstance = sharpInstance.jpeg({
          quality: config.quality || 80,
        });
      } else if (config.format === "png") {
        // PNG圧縮レベル: 品質値(0-100)を圧縮レベル(0-9)に変換
        // 高品質(100) = 低圧縮(0), 低品質(0) = 高圧縮(9)
        const compressionLevel = Math.max(
          0,
          Math.min(9, Math.round((100 - (config.quality || 80)) / 10)),
        );
        sharpInstance = sharpInstance.png({
          compressionLevel,
        });
      }

      // 画像処理を実行
      const processedBuffer = await sharpInstance.toBuffer();
      return new Uint8Array(processedBuffer);
    } catch (error) {
      throw new S3Error(
        `Image processing failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        "IMAGE_PROCESSING_ERROR",
      );
    } finally {
      // Sharpインスタンスの明示的なクリーンアップ
      // Sharp v0.32以降では自動でクリーンアップされるが、明示的に行うことを推奨
      if (sharpInstance) {
        try {
          // Sharp v0.33+ では destroy() メソッドが利用可能
          if (typeof sharpInstance.destroy === "function") {
            sharpInstance.destroy();
          }
        } catch (destroyError) {
          // destroy() の失敗は警告のみ（メモリリークを防ぐため）
          logWarn("Failed to destroy Sharp instance:", "ui", {
            data: destroyError,
          });
        } finally {
          sharpInstance = null;
        }
      }
    }
  }

  /**
   * 画像処理パイプライン: 一時バケットから画像を取得し、処理してから本番バケットに移動
   * @param tmpKey 一時バケットのキー
   * @param processingConfig 画像処理設定
   * @param finalKey 最終的なキー（オプション）
   * @returns 処理結果
   */
  async processAndMoveImage(
    tmpKey: string,
    processingConfig: ImageProcessingConfig,
    finalKey?: string,
  ): Promise<UploadResult> {
    assertS3ObjectKeyPrefix(tmpKey, "tmp/");
    const prodKey = finalKey || tmpKey.replace("tmp/", "prod/");
    assertS3ObjectKeyPrefix(prodKey, "prod/");

    try {
      // 1. 一時バケットから画像データを取得
      const originalImageData = await this.getObject(tmpKey, this.tmpBucket);

      // 2. 画像を処理
      const processedImageData = await this.processImage(
        originalImageData,
        processingConfig,
      );

      // 3. 最終キーを決定
      // 4. 処理された画像を本番バケットにアップロード
      const contentType =
        processingConfig.format === "webp"
          ? "image/webp"
          : processingConfig.format === "jpeg"
            ? "image/jpeg"
            : processingConfig.format === "png"
              ? "image/png"
              : "image/webp"; // デフォルトはWebP

      await putObject(
        this.prodBucket,
        prodKey,
        processedImageData,
        contentType,
      );

      // 5. 一時バケットから元のファイルを安全に削除
      await this.safeDeleteObject(tmpKey, this.tmpBucket);

      return {
        key: prodKey,
        bucket: this.prodBucket,
        url: `/${this.prodBucket}/${prodKey}`,
        size: processedImageData.length,
        contentType,
      };
    } catch (error) {
      if (error instanceof SecurityValidationError) {
        throw error;
      }
      throw new S3Error(
        `Image processing pipeline failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        "IMAGE_PROCESSING_PIPELINE_ERROR",
      );
    }
  }
}

/**
 * グローバルS3画像処理サービスインスタンス
 */
export const s3ImageService = new S3ImageService();
