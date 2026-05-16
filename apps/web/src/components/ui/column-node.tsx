import { cn, withRef } from "@udecode/cn";
import type { TElement } from "platejs";
import { PlateElement, useElement } from "platejs/react";

interface ColumnTElement extends TElement {
  width?: string;
}

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
    const element = useElement<ColumnTElement>();
    const width = element.width;

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
