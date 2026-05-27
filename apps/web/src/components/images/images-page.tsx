import { useCallback, useEffect, useReducer } from "react";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";

type ImageItem = {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  url: string;
};

interface ImagesPageState {
  images: ImageItem[];
  selectedFile: File | null;
  isLoading: boolean;
  isUploading: boolean;
  error: string | null;
}

type ImagesPageAction =
  | { type: "load-start" }
  | { type: "load-success"; images: ImageItem[] }
  | { type: "load-error"; message: string }
  | { type: "select-file"; file: File | null }
  | { type: "upload-start" }
  | { type: "upload-complete" }
  | { type: "upload-error"; message: string }
  | { type: "delete-error"; message: string }
  | { type: "clear-error" };

const initialImagesPageState: ImagesPageState = {
  images: [],
  selectedFile: null,
  isLoading: true,
  isUploading: false,
  error: null,
};

function imagesPageReducer(
  state: ImagesPageState,
  action: ImagesPageAction,
): ImagesPageState {
  switch (action.type) {
    case "load-start":
      return { ...state, isLoading: true, error: null };
    case "load-success":
      return { ...state, images: action.images, isLoading: false };
    case "load-error":
      return { ...state, isLoading: false, error: action.message };
    case "select-file":
      return { ...state, selectedFile: action.file, error: null };
    case "upload-start":
      return { ...state, isUploading: true, error: null };
    case "upload-complete":
      return { ...state, selectedFile: null, isUploading: false };
    case "upload-error":
      return { ...state, isUploading: false, error: action.message };
    case "delete-error":
      return { ...state, error: action.message };
    case "clear-error":
      return { ...state, error: null };
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました";
}

export function ImagesPage() {
  const [state, dispatch] = useReducer(
    imagesPageReducer,
    initialImagesPageState,
  );

  const loadImages = useCallback(async () => {
    try {
      dispatch({ type: "load-start" });
      const response = await client.api.s3.list.$get({
        query: { bucket: "prod" },
      });
      if (!response.ok) {
        throw new Error("画像一覧の取得に失敗しました");
      }
      const json = await response.json();
      dispatch({ type: "load-success", images: json.data?.images ?? [] });
    } catch (loadError) {
      dispatch({ type: "load-error", message: getErrorMessage(loadError) });
    }
  }, []);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  const uploadImage = async () => {
    if (!state.selectedFile) return;

    try {
      dispatch({ type: "upload-start" });

      const presignedResponse = await client.api.s3["presigned-upload"].$post({
        json: {
          fileName: state.selectedFile.name,
          fileSize: state.selectedFile.size,
          mimeType: state.selectedFile.type,
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
        body: state.selectedFile,
        headers: {
          "content-type": state.selectedFile.type,
        },
      });

      if (!putResponse.ok) {
        throw new Error("S3アップロードに失敗しました");
      }

      const completeResponse = await client.api.s3["upload-complete"].$post({
        json: {
          key: presignedJson.data.key,
          bucket: "tmp",
          size: state.selectedFile.size,
          contentType: state.selectedFile.type,
        },
      });

      if (!completeResponse.ok) {
        throw new Error("アップロード完了通知に失敗しました");
      }

      const moveResponse = await client.api.s3.move.$post({
        json: { tmpKey: presignedJson.data.key },
      });
      if (!moveResponse.ok) {
        throw new Error("画像の移動に失敗しました");
      }

      await loadImages();
      dispatch({ type: "upload-complete" });
    } catch (uploadError) {
      dispatch({ type: "upload-error", message: getErrorMessage(uploadError) });
    }
  };

  const deleteImage = async (key: string) => {
    try {
      dispatch({ type: "clear-error" });
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
      dispatch({
        type: "delete-error",
        message: getErrorMessage(deleteError),
      });
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
            dispatch({
              type: "select-file",
              file: event.target.files?.[0] ?? null,
            });
          }}
          className="text-sm"
          disabled={state.isUploading}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => void uploadImage()}
          disabled={!state.selectedFile || state.isUploading}
        >
          {state.isUploading ? "アップロード中..." : "アップロード"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void loadImages()}
        >
          再読み込み
        </Button>
      </div>

      {state.error ? (
        <p className="mt-3 text-sm text-destructive">{state.error}</p>
      ) : null}

      {state.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">読み込み中...</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {state.images.map((image) => (
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
          {state.images.length === 0 ? (
            <li className="rounded border p-3 text-sm text-muted-foreground">
              画像はまだありません。
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
