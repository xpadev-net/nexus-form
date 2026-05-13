import { cn, withRef } from "@udecode/cn";
import { PlateElement, PlateLeaf } from "platejs/react";

export const CodeBlockElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      as="pre"
      className={cn(
        "my-2 overflow-x-auto rounded-lg bg-muted/50 px-6 py-4 font-mono text-sm leading-[normal]",
        "[&_code]:bg-transparent [&_code]:p-0 [&_code]:font-mono [&_code]:text-sm",
        className,
      )}
      {...props}
    >
      <code>{children}</code>
    </PlateElement>
  ),
);

export const CodeLineElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => (
    <PlateElement
      ref={ref}
      className={cn("min-h-[1.5em]", className)}
      {...props}
    >
      {children}
    </PlateElement>
  ),
);

export const CodeSyntaxLeaf = withRef<typeof PlateLeaf>(
  ({ children, className, ...props }, ref) => {
    const tokenType = (props.leaf as Record<string, unknown>).tokenType as
      | string
      | undefined;

    return (
      <PlateLeaf
        ref={ref}
        className={cn(
          className,
          tokenType && `prism-token token ${tokenType}`,
        )}
        {...props}
      >
        {children}
      </PlateLeaf>
    );
  },
);
