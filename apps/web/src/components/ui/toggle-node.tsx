import { cn, withRef } from "@udecode/cn";
import {
  useToggleButton,
  useToggleButtonState,
} from "@platejs/toggle/react";
import { ChevronRightIcon } from "lucide-react";
import type { TElement } from "platejs";
import { PlateElement, useElement } from "platejs/react";
import { Button } from "@/components/ui/button";

export const ToggleElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const element = useElement<TElement>();
    const toggleId = element.id as string;
    const state = useToggleButtonState(toggleId);
    const { buttonProps, open } = useToggleButton(state);

    return (
      <PlateElement
        ref={ref}
        className={cn("my-1 pl-6", className)}
        {...props}
      >
        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(
              "absolute -left-6 top-0.5 cursor-pointer text-muted-foreground transition-transform duration-200 hover:bg-muted dark:hover:bg-muted rounded-sm",
              open && "rotate-90",
            )}
            contentEditable={false}
            {...buttonProps}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
          {children}
        </div>
      </PlateElement>
    );
  },
);
