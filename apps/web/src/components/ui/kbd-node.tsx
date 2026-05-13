import { cn, withRef } from "@udecode/cn";
import { PlateLeaf } from "platejs/react";

export const KbdLeaf = withRef<typeof PlateLeaf>(
  ({ children, className, ...props }, ref) => (
    <PlateLeaf
      ref={ref}
      as="kbd"
      className={cn(
        "rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.8em] font-medium shadow-[0_1px_0_1px_rgba(0,0,0,0.08)]",
        className,
      )}
      {...props}
    >
      {children}
    </PlateLeaf>
  ),
);
