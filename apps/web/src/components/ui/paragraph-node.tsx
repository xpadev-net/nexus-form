import { cn, withRef } from "@udecode/cn";
import { PlateElement } from "platejs/react";

export const ParagraphElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      className={cn("m-0 px-0 py-1", className)}
      {...props}
    >
      {children}
    </PlateElement>
  ),
);
