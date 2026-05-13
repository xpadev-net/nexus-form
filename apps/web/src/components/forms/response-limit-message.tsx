import type { FC } from "react";

interface ResponseLimitMessageProps {
  maxResponses: number;
  formTitle?: string;
}

export const ResponseLimitMessage: FC<ResponseLimitMessageProps> = ({
  maxResponses,
  formTitle,
}) => {
  return (
    <div className="flex min-h-[300px] items-center justify-center">
      <div className="max-w-md rounded-lg border border-amber-200 bg-amber-50 p-6 text-center">
        <div className="mb-3 text-3xl">&#x26A0;</div>
        <h2 className="mb-2 text-lg font-semibold text-amber-800">
          回答受付を終了しました
        </h2>
        {formTitle && (
          <p className="mb-2 text-sm font-medium text-amber-700">{formTitle}</p>
        )}
        <p className="text-sm text-amber-600">
          このフォームは回答数の上限（{maxResponses}
          件）に達したため、新しい回答を受け付けていません。
        </p>
      </div>
    </div>
  );
};
