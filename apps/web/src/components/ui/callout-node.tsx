import { cn, withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement } from "platejs/react";

interface CalloutTElement extends TElement {
  variant?: string;
  icon?: string;
}

export const CalloutElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const element = useElement<CalloutTElement>();

    const variantStyles: Record<string, string> = {
      info: "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/50",
      warning:
        "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/50",
      error:
        "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50",
      success:
        "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/50",
      default: "border-border bg-muted/50",
    };

    const variant = element.variant ?? "default";
    const icon = element.icon;

    return (
      <PlateElement
        ref={ref}
        className={cn(
          "my-2 flex gap-3 rounded-lg border p-4",
          variantStyles[variant] ?? variantStyles.default,
          className,
        )}
        {...props}
      >
        {icon && (
          <span
            className="select-none text-lg leading-none"
            contentEditable={false}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </PlateElement>
    );
  },
);
