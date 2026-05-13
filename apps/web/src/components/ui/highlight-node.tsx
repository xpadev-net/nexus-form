import { cn, withRef } from "@udecode/cn";
import { PlateLeaf } from "platejs/react";

export const HighlightLeaf = withRef<typeof PlateLeaf>(
  ({ children, className, ...props }, ref) => (
    <PlateLeaf
      ref={ref}
      as="mark"
      className={cn("bg-highlight/30 text-inherit dark:bg-highlight/30", className)}
      {...props}
    >
      {children}
    </PlateLeaf>
  ),
);
