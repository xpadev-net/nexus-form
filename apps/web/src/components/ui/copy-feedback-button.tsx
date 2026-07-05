import { Check, Copy, TriangleAlert } from "lucide-react";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import type { CopyFeedbackStatus } from "@/hooks/use-copy-feedback";

interface CopyFeedbackLabels {
  idle: string;
  copied: string;
  failed: string;
}

interface CopyFeedbackButtonProps
  extends Omit<
    ComponentProps<typeof Button>,
    "aria-label" | "children" | "size" | "title"
  > {
  labels: CopyFeedbackLabels;
  status: CopyFeedbackStatus;
}

export function CopyFeedbackButton({
  labels,
  status,
  type = "button",
  variant = "outline",
  ...props
}: CopyFeedbackButtonProps) {
  const label = labels[status];
  const Icon =
    status === "copied" ? Check : status === "failed" ? TriangleAlert : Copy;

  return (
    <Button
      {...props}
      type={type}
      variant={variant}
      size="icon"
      aria-label={label}
      title={label}
      data-copy-status={status}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
