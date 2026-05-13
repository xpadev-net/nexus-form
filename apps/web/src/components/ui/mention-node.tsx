import { cn, withRef } from "@udecode/cn";
import { useComboboxInput } from "@platejs/combobox/react";
import type { TElement } from "platejs";
import { PlateElement, useElement, useSelected } from "platejs/react";
import { useRef } from "react";

export const MentionElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const element = useElement<TElement>();
    const selected = useSelected();

    const value = (element as unknown as Record<string, string>).value;

    return (
      <PlateElement
        ref={ref}
        as="span"
        className={cn(
          "inline-block rounded-md bg-muted px-1.5 py-0.5 align-baseline text-sm font-medium",
          selected && "ring-2 ring-ring",
          className,
        )}
        data-slate-value={value}
        {...props}
      >
        @{value}
        {children}
      </PlateElement>
    );
  },
);

export const MentionInputElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const inputRef = useRef<HTMLSpanElement>(null);

    const { removeInput } = useComboboxInput({
      ref: inputRef,
      onCancelInput: (cause) => {
        if (cause !== "backspace") {
          removeInput(true);
        }
      },
    });

    return (
      <PlateElement
        ref={ref}
        as="span"
        className={cn(
          "inline-block rounded-md bg-muted px-1.5 py-0.5 align-baseline text-sm",
          className,
        )}
        {...props}
      >
        <span ref={inputRef}>@{children}</span>
      </PlateElement>
    );
  },
);
