/**
 * S3関連の型定義
 */

/**
 * アップロード結果
 */
export interface UploadResult {
  key: string;
  bucket: string;
  url: string;
  size: number;
  contentType: string;
}

/**
 * プリサインドURL生成結果
 */
export interface PresignedUrlResult {
  url: string;
  key: string;
  expiresIn: number;
}

/**
 * 画像処理設定
 */
export interface ImageProcessingConfig {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: "webp" | "jpeg" | "png";
}

/**
 * ファイルアップロード設定
 */
export interface FileUploadConfig {
  maxSize: number; // バイト単位
  allowedTypes: string[];
  imageProcessing?: ImageProcessingConfig;
}

/**
 * S3エラー
 */
export class S3Error extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "S3Error";
  }
}
