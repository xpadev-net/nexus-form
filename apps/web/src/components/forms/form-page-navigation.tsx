import { ArrowLeft, ArrowRight } from "lucide-react";
import type { FC } from "react";
import { Button } from "@/components/ui/button";

interface FormPageNavigationProps {
  step: "first" | "middle";
  nextAction: "next" | "submit";
  submitAvailability: "ready" | "submitting" | "captcha-pending";
  onPrevious: () => void;
  onNext: () => void;
  totalPages: number;
  currentPageIndex: number;
}

export const FormPageNavigation: FC<FormPageNavigationProps> = ({
  step,
  nextAction,
  submitAvailability,
  onPrevious,
  onNext,
  totalPages,
  currentPageIndex,
}) => {
  const showSubmitButton = nextAction === "submit";

  return (
    <div className="flex items-center justify-between pt-2">
      <div>
        {step !== "first" && (
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
            disabled={submitAvailability !== "ready"}
          >
            {submitAvailability === "submitting" ? "送信中..." : "回答を送信"}
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
