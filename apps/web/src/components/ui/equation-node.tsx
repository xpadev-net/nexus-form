import { cn, withRef } from "@udecode/cn";
import { RadicalIcon } from "lucide-react";
import type { TElement } from "platejs";
import { PlateElement, useElement, useSelected } from "platejs/react";

interface EquationTElement extends TElement {
  texExpression?: string;
}

export const EquationElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const element = useElement<EquationTElement>();
    const selected = useSelected();

    const texExpression = element.texExpression;

    return (
      <PlateElement
        ref={ref}
        className={cn(
          "my-2 rounded-md py-2",
          selected && "ring-2 ring-ring ring-offset-2",
          className,
        )}
        {...props}
      >
        <div className="flex items-center justify-center p-4">
          {texExpression ? (
            <span className="font-mono text-sm">{texExpression}</span>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <RadicalIcon className="size-5" />
              <span className="text-sm">Add a TeX equation</span>
            </div>
          )}
        </div>
        {children}
      </PlateElement>
    );
  },
);

export const InlineEquationElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const element = useElement<EquationTElement>();
    const selected = useSelected();

    const texExpression = element.texExpression;

    return (
      <PlateElement
        ref={ref}
        as="span"
        className={cn(
          "inline-flex items-center rounded bg-muted px-1 py-0.5 align-baseline font-mono text-sm",
          selected && "ring-2 ring-ring",
          className,
        )}
        {...props}
      >
        {texExpression || (
          <RadicalIcon className="inline size-4 text-muted-foreground" />
        )}
        {children}
      </PlateElement>
    );
  },
);
