import { cn, withRef } from "@udecode/cn";
import { CalendarIcon } from "lucide-react";
import type { TElement } from "platejs";
import { PlateElement, useElement, useSelected } from "platejs/react";

export const DateElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const element = useElement<TElement>();
    const selected = useSelected();

    const dateValue = (element as unknown as Record<string, string>).date;
    const displayDate = dateValue
      ? new Date(dateValue).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "Pick a date";

    return (
      <PlateElement
        ref={ref}
        as="span"
        className={cn(
          "inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 align-baseline text-sm",
          selected && "ring-2 ring-ring",
          className,
        )}
        {...props}
      >
        <CalendarIcon className="size-3.5 text-muted-foreground" />
        <span>{displayDate}</span>
        {children}
      </PlateElement>
    );
  },
);
