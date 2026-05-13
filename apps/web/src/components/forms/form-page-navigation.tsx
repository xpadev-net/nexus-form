import { ArrowLeft, ArrowRight } from "lucide-react";
import type { FC } from "react";
import { Button } from "@/components/ui/button";

interface FormPageNavigationProps {
  isFirstPage: boolean;
  isLastPage: boolean;
  shouldSubmit: boolean;
  isSubmitting: boolean;
  captchaReady: boolean;
  onPrevious: () => void;
  onNext: () => void;
  totalPages: number;
  currentPageIndex: number;
}

export const FormPageNavigation: FC<FormPageNavigationProps> = ({
  isFirstPage,
  isLastPage,
  shouldSubmit,
  isSubmitting,
  captchaReady,
  onPrevious,
  onNext,
  totalPages,
  currentPageIndex,
}) => {
  const showSubmitButton = isLastPage || shouldSubmit;

  return (
    <div className="flex items-center justify-between pt-2">
      <div>
        {!isFirstPage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPrevious}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            戻る
          </Button>
        )}
      </div>

      <span className="text-xs text-muted-foreground">
        {currentPageIndex + 1} / {totalPages}
      </span>

      <div>
        {showSubmitButton ? (
          <Button
            type="submit"
            size="sm"
            disabled={isSubmitting || !captchaReady}
          >
            {isSubmitting ? "送信中..." : "回答を送信"}
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={onNext}>
            次へ
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
};
