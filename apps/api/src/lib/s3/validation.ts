import { S3Error } from "../../types/s3";

/**
 * ファイル検証結果
 */
export interface FileValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * ファイルタイプ別のサイズ制限設定
 */
export interface FileTypeSizeLimits {
  [mimeType: string]: number;
}

/**
 * ファイル検証設定
 */
export interface FileValidationConfig {
  maxSize: number;
  allowedTypes: string[];
  allowedExtensions: string[];
  maxFileNameLength: number;
  scanForMalware: boolean;
  allowSvg: boolean; // SVGファイルの許可設定
  svgContentValidation: boolean; // SVGコンテンツ検証の有効化
  fileTypeSizeLimits?: FileTypeSizeLimits; // ファイルタイプ別のサイズ制限
}

const allowedObjectKeyPrefixes = ["tmp/", "prod/"] as const;

function hasUnsafeObjectKeyPathSegment(key: string): boolean {
  return key.split("/").some((segment) => segment === "..");
}

/**
 * デフォルトの検証設定
 */
export const DEFAULT_VALIDATION_CONFIG: FileValidationConfig = {
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/svg+xml",
  ],
  allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"],
  maxFileNameLength: 255,
  scanForMalware: false, // 本番環境では有効にする
  allowSvg: true, // デフォルトでSVGを許可（セキュリティ要件に応じて変更可能）
  svgContentValidation: true, // SVGコンテンツ検証を有効化
  fileTypeSizeLimits: {
    "image/jpeg": 5 * 1024 * 1024, // 5MB for JPEG
    "image/png": 8 * 1024 * 1024, // 8MB for PNG
    "image/gif": 3 * 1024 * 1024, // 3MB for GIF
    "image/webp": 4 * 1024 * 1024, // 4MB for WebP
    "image/svg+xml": 1 * 1024 * 1024, // 1MB for SVG
  },
};

/**
 * ファイル名の安全性を検証する
 * @param fileName ファイル名
 * @returns 検証結果
 */
export function validateFileName(fileName: string): FileValidationResult {
  const errors: string[] = [];

  // ファイル名の長さチェック
  if (fileName.length === 0) {
    errors.push("File name cannot be empty");
  }

  if (fileName.length > 255) {
    errors.push("File name is too long (max 255 characters)");
  }

  // 危険な文字のチェック
  const dangerousChars = /[<>:"/\\|?*]/;
  if (dangerousChars.test(fileName)) {
    errors.push("File name contains dangerous characters");
  }

  // 制御文字のチェック
  for (let i = 0; i < fileName.length; i++) {
    const charCode = fileName.charCodeAt(i);
    if (charCode < 32) {
      errors.push("File name contains control characters");
      break;
    }
  }

  // パストラバーサル攻撃の防止
  if (
    fileName.includes("..") ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    errors.push("File name contains path traversal characters");
  }

  // 予約語のチェック（Windows）
  const reservedNames = [
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "COM1",
    "COM2",
    "COM3",
    "COM4",
    "COM5",
    "COM6",
    "COM7",
    "COM8",
    "COM9",
    "LPT1",
    "LPT2",
    "LPT3",
    "LPT4",
    "LPT5",
    "LPT6",
    "LPT7",
    "LPT8",
    "LPT9",
  ];

  const nameWithoutExt = (fileName.split(".")[0] ?? "").toUpperCase();
  if (reservedNames.includes(nameWithoutExt)) {
    errors.push("File name uses a reserved system name");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * S3 オブジェクトキーが署名・削除対象として安全な名前空間にあるか検証する。
 *
 * @param key - 検証する S3 オブジェクトキー。`tmp/` または `prod/` で始まる必要がある。
 * @returns `FileValidationResult`。`..` パスセグメント、連続スラッシュ、バックスラッシュ、制御文字を含む場合は invalid。
 */
export function validateS3ObjectKey(key: string): FileValidationResult {
  const errors: string[] = [];

  if (key.length === 0) {
    errors.push("Object key cannot be empty");
  }

  if (!allowedObjectKeyPrefixes.some((prefix) => key.startsWith(prefix))) {
    errors.push("Object key must start with tmp/ or prod/");
  }

  if (
    key.startsWith("/") ||
    hasUnsafeObjectKeyPathSegment(key) ||
    key.includes("//") ||
    key.includes("\\")
  ) {
    errors.push("Object key contains unsafe path segments");
  }

  for (let i = 0; i < key.length; i++) {
    if (key.charCodeAt(i) < 32) {
      errors.push("Object key contains control characters");
      break;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * S3 オブジェクトキーが安全でない場合に例外を投げる。
 *
 * @param key - 検証する S3 オブジェクトキー。`tmp/` または `prod/` 名前空間のみ許可する。
 * @throws SecurityValidationError `validateS3ObjectKey` が invalid を返した場合。
 */
export function assertValidS3ObjectKey(key: string): void {
  const validation = validateS3ObjectKey(key);
  if (!validation.isValid) {
    throw new SecurityValidationError(
      "Object key validation failed",
      validation.errors,
    );
  }
}

/**
 * S3 オブジェクトキーが安全で、期待する名前空間 prefix に属することを検証する。
 *
 * @param key - 検証する S3 オブジェクトキー。
 * @param prefix - 期待する名前空間 prefix。`tmp/` または `prod/` のみ指定できる。
 * @throws SecurityValidationError キー自体が unsafe、または指定 prefix と一致しない場合。
 */
export function assertS3ObjectKeyPrefix(
  key: string,
  prefix: (typeof allowedObjectKeyPrefixes)[number],
): void {
  assertValidS3ObjectKey(key);
  if (!key.startsWith(prefix)) {
    throw new SecurityValidationError(`Object key must start with ${prefix}`, [
      `Object key must start with ${prefix}`,
    ]);
  }
}

/**
 * ファイルサイズを検証する
 * @param size ファイルサイズ（バイト）
 * @param maxSize 最大サイズ（バイト）
 * @returns 検証結果
 */
export function validateFileSize(
  size: number,
  maxSize: number,
  mimeType?: string,
  fileTypeSizeLimits?: FileTypeSizeLimits,
): FileValidationResult {
  const errors: string[] = [];

  if (size <= 0) {
    errors.push("File size must be greater than 0");
  }

  // ファイルタイプ別のサイズ制限をチェック
  let effectiveMaxSize = maxSize;
  if (mimeType && fileTypeSizeLimits?.[mimeType]) {
    effectiveMaxSize = Math.min(maxSize, fileTypeSizeLimits[mimeType]);
  }

  if (size > effectiveMaxSize) {
    const limitType =
      mimeType &&
      fileTypeSizeLimits?.[mimeType] &&
      fileTypeSizeLimits[mimeType] < maxSize
        ? `file type specific limit of ${formatBytes(fileTypeSizeLimits?.[mimeType])}`
        : `maximum allowed size of ${formatBytes(maxSize)}`;
    errors.push(`File size exceeds ${limitType}`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * ファイルタイプを検証する
 * @param mimeType MIMEタイプ
 * @param allowedTypes 許可されたMIMEタイプのリスト
 * @returns 検証結果
 */
export function validateMimeType(
  mimeType: string,
  allowedTypes: string[],
): FileValidationResult {
  const errors: string[] = [];

  if (!mimeType) {
    errors.push("File type cannot be determined");
    return { isValid: false, errors };
  }

  if (!allowedTypes.includes(mimeType)) {
    errors.push(
      `File type '${mimeType}' is not allowed. Allowed types: ${allowedTypes.join(", ")}`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * ファイル拡張子を検証する
 * @param fileName ファイル名
 * @param allowedExtensions 許可された拡張子のリスト
 * @returns 検証結果
 */
export function validateFileExtension(
  fileName: string,
  allowedExtensions: string[],
): FileValidationResult {
  const errors: string[] = [];

  const extension = fileName.toLowerCase().substring(fileName.lastIndexOf("."));

  if (!extension || extension === fileName) {
    errors.push("File must have a valid extension");
    return { isValid: false, errors };
  }

  if (!allowedExtensions.includes(extension)) {
    errors.push(
      `File extension '${extension}' is not allowed. Allowed extensions: ${allowedExtensions.join(", ")}`,
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * ファイルのマジックナンバーを検証する（MIMEタイプの偽装を防ぐ）
 * @param fileData ファイルの先頭バイト
 * @param mimeType 宣言されたMIMEタイプ
 * @returns 検証結果
 */
export function validateMagicNumber(
  fileData: Uint8Array,
  mimeType: string,
): FileValidationResult {
  const errors: string[] = [];

  if (fileData.length < 4) {
    errors.push("File is too small to validate");
    return { isValid: false, errors };
  }

  // 一般的な画像ファイルのマジックナンバー
  const magicNumbers: Record<string, number[][]> = {
    "image/jpeg": [[0xff, 0xd8, 0xff]],
    "image/png": [[0x89, 0x50, 0x4e, 0x47]],
    "image/gif": [
      [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    ],
    "image/webp": [[0x52, 0x49, 0x46, 0x46]], // RIFF (WebPはRIFFコンテナ)
    "image/svg+xml": [[0x3c, 0x3f, 0x78, 0x6d, 0x6c]], // <?xml
  };

  const expectedMagic = magicNumbers[mimeType];
  if (!expectedMagic) {
    // マジックナンバーが定義されていない場合はスキップ
    return { isValid: true, errors: [] };
  }

  let isValidMagic = false;

  // Special handling for WebP files - check both RIFF header and WEBP signature
  if (mimeType === "image/webp" && fileData.length >= 12) {
    const riffHeader = [0x52, 0x49, 0x46, 0x46]; // RIFF
    const webpSignature = [0x57, 0x45, 0x42, 0x50]; // WEBP at offset 8

    const hasRiffHeader = riffHeader.every(
      (byte, index) => fileData[index] === byte,
    );
    const hasWebpSignature = webpSignature.every(
      (byte, index) => fileData[8 + index] === byte,
    );

    isValidMagic = hasRiffHeader && hasWebpSignature;
  } else {
    // Standard magic number validation for other file types
    for (const magic of expectedMagic) {
      if (magic.every((byte, index) => fileData[index] === byte)) {
        isValidMagic = true;
        break;
      }
    }
  }

  if (!isValidMagic) {
    errors.push(`File content does not match declared MIME type '${mimeType}'`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * 包括的なファイル検証を実行する
 * @param file ファイルオブジェクト
 * @param config 検証設定
 * @returns 検証結果
 */
export async function validateFile(
  file: File,
  config: FileValidationConfig = DEFAULT_VALIDATION_CONFIG,
): Promise<FileValidationResult> {
  const allErrors: string[] = [];

  // ファイル名の検証
  const nameValidation = validateFileName(file.name);
  if (!nameValidation.isValid) {
    allErrors.push(...nameValidation.errors);
  }

  // ファイルサイズの検証
  const sizeValidation = validateFileSize(
    file.size,
    config.maxSize,
    file.type,
    config.fileTypeSizeLimits,
  );
  if (!sizeValidation.isValid) {
    allErrors.push(...sizeValidation.errors);
  }

  // MIMEタイプの検証
  const mimeValidation = validateMimeType(file.type, config.allowedTypes);
  if (!mimeValidation.isValid) {
    allErrors.push(...mimeValidation.errors);
  }

  // 拡張子の検証
  const extensionValidation = validateFileExtension(
    file.name,
    config.allowedExtensions,
  );
  if (!extensionValidation.isValid) {
    allErrors.push(...extensionValidation.errors);
  }

  // マジックナンバーの検証（ファイルの先頭部分を読み取り）
  if (file.size > 0) {
    try {
      const fileData = new Uint8Array(await file.slice(0, 16).arrayBuffer());
      const magicValidation = validateMagicNumber(fileData, file.type);
      if (!magicValidation.isValid) {
        allErrors.push(...magicValidation.errors);
      }
    } catch (_error) {
      allErrors.push("Failed to read file for magic number validation");
    }
  }

  // SVGファイルの特別な検証
  if (
    file.type === "image/svg+xml" &&
    config.allowSvg &&
    config.svgContentValidation
  ) {
    try {
      const fullFileData = new Uint8Array(await file.arrayBuffer());
      const svgValidation = validateSvgContent(fullFileData);
      if (!svgValidation.isValid) {
        allErrors.push(...svgValidation.errors);
      }
    } catch (_error) {
      allErrors.push("Failed to validate SVG content");
    }
  }

  // SVGが許可されていない場合のチェック
  if (file.type === "image/svg+xml" && !config.allowSvg) {
    allErrors.push("SVG files are not allowed");
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
  };
}

/**
 * SVGファイルのコンテンツを検証する
 * @param fileData ファイルデータ
 * @returns 検証結果
 */
function validateSvgContent(fileData: Uint8Array): FileValidationResult {
  const errors: string[] = [];

  try {
    // UTF-8としてデコード
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const content = decoder.decode(fileData);

    // 危険な要素や属性をチェック
    const dangerousPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, // <script>タグ
      /javascript:/gi, // javascript:プロトコル
      /on\w+\s*=/gi, // イベントハンドラー
      /<iframe\b/gi, // <iframe>タグ
      /<object\b/gi, // <object>タグ
      /<embed\b/gi, // <embed>タグ
      /<link\b[^>]*rel\s*=\s*["']stylesheet["']/gi, // 外部スタイルシート
      /<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, // <style>タグ
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(content)) {
        errors.push("SVG file contains potentially dangerous content");
        break;
      }
    }

    // SVGの基本構造をチェック
    if (!content.includes("<svg") || !content.includes("</svg>")) {
      errors.push("Invalid SVG structure");
    }
  } catch (_error) {
    errors.push("Failed to validate SVG content");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * バイト数を人間が読みやすい形式に変換する
 * @param bytes バイト数
 * @returns フォーマットされた文字列
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

/**
 * セキュリティ検証エラー
 */
export class SecurityValidationError extends S3Error {
  constructor(
    message: string,
    public readonly validationErrors: string[],
  ) {
    super(message, "SECURITY_VALIDATION_ERROR", 400);
    this.name = "SecurityValidationError";
  }
}
