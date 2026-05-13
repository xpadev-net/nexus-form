import { useRef } from "react";
import { toast } from "sonner";
import { z } from "zod";

export interface ImageUploadResult {
  success: boolean;
  url?: string;
  error?: string;
}

const presignedUploadResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    presignedUrl: z.string().url(),
    key: z.string(),
  }),
  error: z.string().optional(),
});

const moveResponseSchema = z.object({
  data: z.object({
    key: z.string(),
  }),
});

/**
 * Markdownエディタ用の画像アップロード機能
 */
export class MarkdownImageUploader {
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

  /**
   * ファイルをS3にアップロードし、公開URLを取得
   */
  async uploadImage(file: File): Promise<string> {
    try {
      // 1. presigned URLを取得
      const presignedResponse = await this.getPresignedUrl(file);
      if (!presignedResponse.success) {
        throw new Error(
          presignedResponse.error || "Failed to get presigned URL",
        );
      }

      // 2. ファイルをS3にアップロード
      await this.uploadToS3(presignedResponse.data.presignedUrl, file);

      // 3. アップロード完了を通知
      await this.notifyUploadComplete(
        presignedResponse.data.key,
        file.size,
        file.type,
      );

      // 4. tmpからprodに移動
      const moveResponse = await fetch("/api/s3/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmpKey: presignedResponse.data.key }),
      });

      if (!moveResponse.ok) {
        throw new Error("Failed to move file from tmp to prod");
      }

      const moveJson: unknown = await moveResponse.json();
      const moveData = moveResponseSchema.parse(moveJson);
      const prodKey = moveData.data.key;

      // 5. 永続的な公開URLを生成
      return `${this.baseUrl}/api/s3/proxy/${prodKey}`;
    } catch (error) {
      console.error("Image upload failed:", error);
      throw error;
    }
  }

  /**
   * presigned URLを取得
   */
  private async getPresignedUrl(
    file: File,
  ): Promise<z.infer<typeof presignedUploadResponseSchema>> {
    const response = await fetch("/api/s3/presigned-upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
      }),
    });

    if (!response.ok) {
      const errorData: unknown = await response.json().catch(() => ({}));
      const message =
        errorData &&
        typeof errorData === "object" &&
        "error" in errorData &&
        typeof (errorData as { error?: string }).error === "string"
          ? (errorData as { error: string }).error
          : "Failed to get presigned URL";
      throw new Error(message);
    }

    const json: unknown = await response.json();
    return presignedUploadResponseSchema.parse(json);
  }

  /**
   * ファイルをS3にアップロード
   */
  private async uploadToS3(presignedUrl: string, file: File): Promise<void> {
    const response = await fetch(presignedUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type,
      },
    });

    if (!response.ok) {
      throw new Error("Failed to upload file to S3");
    }
  }

  /**
   * アップロード完了を通知
   */
  private async notifyUploadComplete(
    key: string,
    size: number,
    contentType: string,
  ): Promise<void> {
    const response = await fetch("/api/s3/upload-complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key,
        size,
        contentType,
      }),
    });

    if (!response.ok) {
      console.warn(
        "Failed to notify upload completion, but upload was successful",
      );
    }
  }

  /**
   * ファイルの検証
   */
  validateFile(file: File): { isValid: boolean; error?: string } {
    // ファイルサイズチェック (10MB制限)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return {
        isValid: false,
        error: "ファイルサイズは10MB以下にしてください",
      };
    }

    // 画像ファイルかチェック（UX用。実際のセキュリティ検証はサーバー側で実施）
    if (!file.type.startsWith("image/")) {
      return {
        isValid: false,
        error: "画像ファイルを選択してください",
      };
    }

    // サポートされている画像形式かチェック
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return {
        isValid: false,
        error:
          "サポートされていない画像形式です。JPEG、PNG、GIF、WebPをサポートしています",
      };
    }

    return { isValid: true };
  }
}

/**
 * Markdownエディタ用の画像アップロードフック
 */
export const useMarkdownImageUpload = (baseUrl?: string) => {
  const uploaderRef = useRef<MarkdownImageUploader | null>(null);
  if (!uploaderRef.current) {
    uploaderRef.current = new MarkdownImageUploader(baseUrl);
  }
  const uploader = uploaderRef.current;

  const uploadImage = async (file: File): Promise<string> => {
    // ファイル検証
    const validation = uploader.validateFile(file);
    if (!validation.isValid) {
      toast.error(validation.error || "ファイルの検証に失敗しました");
      throw new Error(validation.error);
    }

    try {
      const url = await uploader.uploadImage(file);
      toast.success("画像がアップロードされました");
      return url;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "アップロードに失敗しました";
      toast.error(errorMessage);
      throw error;
    }
  };

  return {
    uploadImage,
    validateFile: uploader.validateFile.bind(uploader),
  };
};
