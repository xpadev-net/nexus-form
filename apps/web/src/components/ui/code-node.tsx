import { cn, withRef } from "@udecode/cn";
import { PlateLeaf } from "platejs/react";

export const CodeLeaf = withRef<typeof PlateLeaf>(
  ({ children, className, ...props }, ref) => (
    <PlateLeaf
      ref={ref}
      as="code"
      className={cn(
        "whitespace-pre-wrap rounded-md bg-muted px-[0.3em] py-[0.2em] font-mono text-[0.85em]",
        className,
      )}
      {...props}
    >
      {children}
    </PlateLeaf>
  ),
);
