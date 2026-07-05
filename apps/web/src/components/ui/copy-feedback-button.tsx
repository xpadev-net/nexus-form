import { Check, Copy, TriangleAlert } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
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

const copyFeedbackIcons = {
  copied: Check,
  failed: TriangleAlert,
  idle: Copy,
} satisfies Record<CopyFeedbackStatus, typeof Copy>;

/**
 * Renders a stable-size icon copy button whose accessible label reflects copy state.
 */
export function CopyFeedbackButton({
  labels,
  status,
  type = "button",
  variant = "outline",
  ...props
}: CopyFeedbackButtonProps): ReactElement {
  const label = labels[status];
  const Icon = copyFeedbackIcons[status];

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
