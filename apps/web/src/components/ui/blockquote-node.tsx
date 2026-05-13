import { cn, withRef } from "@udecode/cn";
import { PlateElement } from "platejs/react";

export const BlockquoteElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      as="blockquote"
      className={cn(
        "my-1 border-l-2 border-muted-foreground/30 pl-6 italic text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </PlateElement>
  ),
);
