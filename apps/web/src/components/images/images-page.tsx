import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/api";

const imagesQueryKey = ["s3-images", "prod"] as const;

const ImageItemSchema = z.object({
  key: z.string(),
  name: z.string(),
  size: z.number().nonnegative(),
  lastModified: z.string().nullable(),
  url: z.string(),
});

type ImageItem = z.infer<typeof ImageItemSchema>;

const ListImagesResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    images: z.array(ImageItemSchema),
  }),
});

const S3ErrorBodySchema = z.object({
  error: z.string().optional(),
  validationErrors: z.array(z.string()).optional(),
});

const PresignedUploadResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    presignedUrl: z.string().url(),
    key: z.string().min(1),
  }),
});

const MoveResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    key: z.string().min(1),
  }),
});

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました";
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function getS3ErrorMessage(response: Response, fallback: string) {
  const body = await readJsonSafely(response);
  const parsed = S3ErrorBodySchema.safeParse(body);
  if (!parsed.success) return fallback;

  if (parsed.data.validationErrors && parsed.data.validationErrors.length > 0) {
    return parsed.data.validationErrors.join("\n");
  }

  return parsed.data.error ?? fallback;
}

async function fetchImages(signal?: AbortSignal): Promise<ImageItem[]> {
  const response = await client.api.s3.list.$get(
    {
      query: { bucket: "prod" },
    },
    { init: { signal } },
  );
  if (!response.ok) {
    throw new Error(
      await getS3ErrorMessage(response, "画像一覧の取得に失敗しました"),
    );
  }

  const json = await readJsonSafely(response);
  const parsed = ListImagesResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("画像一覧の取得に失敗しました");
  }

  return parsed.data.data.images;
}

async function uploadImageFile(file: File): Promise<void> {
  const presignedResponse = await client.api.s3["presigned-upload"].$post({
    json: {
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    },
  });

  if (!presignedResponse.ok) {
    throw new Error(
      await getS3ErrorMessage(
        presignedResponse,
        "アップロードURLの発行に失敗しました",
      ),
    );
  }

  const presignedJson = await readJsonSafely(presignedResponse);
  const presignedParsed =
    PresignedUploadResponseSchema.safeParse(presignedJson);
  if (!presignedParsed.success) {
    throw new Error("アップロードURLの発行に失敗しました");
  }

  const { key, presignedUrl } = presignedParsed.data.data;
  const putResponse = await fetch(presignedUrl, {
    method: "PUT",
    body: file,
    headers: {
      "content-type": file.type,
    },
  });

  if (!putResponse.ok) {
    throw new Error("S3アップロードに失敗しました");
  }

  const completeResponse = await client.api.s3["upload-complete"].$post({
    json: {
      key,
      bucket: "tmp",
      size: file.size,
      contentType: file.type,
    },
  });

  if (!completeResponse.ok) {
    throw new Error(
      await getS3ErrorMessage(
        completeResponse,
        "アップロード完了通知に失敗しました",
      ),
    );
  }

  const moveResponse = await client.api.s3.move.$post({
    json: { tmpKey: key },
  });
  if (!moveResponse.ok) {
    throw new Error(
      await getS3ErrorMessage(moveResponse, "画像の移動に失敗しました"),
    );
  }

  const moveJson = await readJsonSafely(moveResponse);
  const moveParsed = MoveResponseSchema.safeParse(moveJson);
  if (
    !moveParsed.success ||
    !moveParsed.data.data.key.startsWith("prod/users/")
  ) {
    throw new Error("画像の本番反映に失敗しました");
  }
}

async function deleteImageFile(key: string): Promise<void> {
  const response = await client.api.s3.delete.$delete({
    json: {
      key,
      bucket: "prod",
    },
  });
  if (!response.ok) {
    throw new Error(
      await getS3ErrorMessage(response, "画像の削除に失敗しました"),
    );
  }
}

export function ImagesPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const imagesQuery = useQuery({
    queryKey: imagesQueryKey,
    queryFn: ({ signal }) => fetchImages(signal),
  });

  const uploadMutation = useMutation({
    mutationFn: uploadImageFile,
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      setSelectedFile(null);
      await queryClient.invalidateQueries({ queryKey: imagesQueryKey });
    },
    onError: (uploadError) => {
      setActionError(getErrorMessage(uploadError));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteImageFile,
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: imagesQueryKey });
    },
    onError: (deleteError) => {
      setActionError(getErrorMessage(deleteError));
    },
  });

  const uploadImage = () => {
    if (!selectedFile) return;
    uploadMutation.mutate(selectedFile);
  };

  const images = imagesQuery.data ?? [];
  const queryError = imagesQuery.error
    ? getErrorMessage(imagesQuery.error)
    : null;
  const error = queryError ?? actionError;
  const isUploading = uploadMutation.isPending;

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
            setActionError(null);
          }}
          className="text-sm"
          disabled={isUploading}
        />
        <Button
          type="button"
          variant="outline"
          onClick={uploadImage}
          disabled={!selectedFile || isUploading}
        >
          {isUploading ? "アップロード中..." : "アップロード"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setActionError(null);
            void imagesQuery.refetch();
          }}
        >
          再読み込み
        </Button>
      </div>

      {error ? (
        <p className="mt-3 whitespace-pre-line text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {imagesQuery.isLoading ? (
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
                onClick={() => deleteMutation.mutate(image.key)}
                disabled={deleteMutation.isPending}
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
