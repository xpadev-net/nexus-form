import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";

type ImageItem = {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  url: string;
};

export function ImagesPage() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadImages = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await client.api.s3.list.$get({
        query: { bucket: "prod" },
      });
      if (!response.ok) {
        throw new Error("画像一覧の取得に失敗しました");
      }
      const json = await response.json();
      setImages(json.data?.images ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "不明なエラーが発生しました",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  const uploadImage = async () => {
    if (!selectedFile) return;

    try {
      setIsUploading(true);
      setError(null);

      const presignedResponse = await client.api.s3["presigned-upload"].$post({
        json: {
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          mimeType: selectedFile.type,
        },
      });

      if (!presignedResponse.ok) {
        throw new Error("アップロードURLの発行に失敗しました");
      }

      const presignedJson = await presignedResponse.json();

      if (!("data" in presignedJson)) {
        throw new Error("アップロードURLの発行に失敗しました");
      }

      const putResponse = await fetch(presignedJson.data.presignedUrl, {
        method: "PUT",
        body: selectedFile,
        headers: {
          "content-type": selectedFile.type,
        },
      });

      if (!putResponse.ok) {
        throw new Error("S3アップロードに失敗しました");
      }

      const completeResponse = await client.api.s3["upload-complete"].$post({
        json: {
          key: presignedJson.data.key,
          bucket: "tmp",
          size: selectedFile.size,
          contentType: selectedFile.type,
        },
      });

      if (!completeResponse.ok) {
        throw new Error("アップロード完了通知に失敗しました");
      }

      setSelectedFile(null);
      await loadImages();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "不明なエラーが発生しました",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const deleteImage = async (key: string) => {
    try {
      setError(null);
      const response = await client.api.s3.delete.$delete({
        json: {
          key,
          bucket: "prod",
        },
      });
      if (!response.ok) {
        throw new Error("画像の削除に失敗しました");
      }
      await loadImages();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "不明なエラーが発生しました",
      );
    }
  };

  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <h1 className="text-2xl font-semibold text-card-foreground">画像管理</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        画像のアップロードと削除ができます。
      </p>

      <div className="mt-6 flex items-center gap-2">
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => {
            setSelectedFile(event.target.files?.[0] ?? null);
            setError(null);
          }}
          className="text-sm"
          disabled={isUploading}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void uploadImage()}
          disabled={!selectedFile || isUploading}
        >
          {isUploading ? "アップロード中..." : "アップロード"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadImages()}
        >
          再読み込み
        </Button>
      </div>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">読み込み中...</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {images.map((image) => (
            <li
              key={image.key}
              className="flex items-center justify-between rounded border p-3"
            >
              <div>
                <p className="font-medium">{image.name}</p>
                <p className="text-xs text-muted-foreground">
                  size: {image.size} bytes
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void deleteImage(image.key)}
              >
                削除
              </Button>
            </li>
          ))}
          {images.length === 0 ? (
            <li className="rounded border p-3 text-sm text-muted-foreground">
              画像はまだありません。
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
