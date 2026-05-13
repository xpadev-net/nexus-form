import { cn, withRef } from "@udecode/cn";
import { PlateElement } from "platejs/react";

export const HrElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      className={cn("my-4 py-2", className)}
      {...props}
    >
      <hr className="h-0.5 cursor-pointer rounded border-none bg-muted" />
      {children}
    </PlateElement>
  ),
);
