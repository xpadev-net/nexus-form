import { cn, withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement } from "platejs/react";

export const ColumnGroupElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      className={cn("my-2 flex gap-4", className)}
      {...props}
    >
      {children}
    </PlateElement>
  ),
);

export const ColumnElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const element = useElement<TElement>();
    const width = (element as unknown as Record<string, string>).width;

    return (
      <PlateElement
        ref={ref}
        className={cn(
          "min-h-[48px] rounded-lg border border-dashed border-border/50 p-4",
          className,
        )}
        style={{ width: width ?? "100%" }}
        {...props}
      >
        {children}
      </PlateElement>
    );
  },
);
