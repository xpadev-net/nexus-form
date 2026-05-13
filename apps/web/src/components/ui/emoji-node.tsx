import { cn, withRef } from "@udecode/cn";
import { useComboboxInput } from "@platejs/combobox/react";
import { PlateElement } from "platejs/react";
import { useRef } from "react";

export const EmojiInputElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const inputRef = useRef<HTMLSpanElement>(null);

    const { removeInput } = useComboboxInput({
      ref: inputRef,
      cancelInputOnBlur: false,
    });

    return (
      <PlateElement
        ref={ref}
        as="span"
        className={cn(
          "inline-block rounded-md bg-muted px-1 py-0.5 text-sm",
          className,
        )}
        {...props}
      >
        <span ref={inputRef}>:{children}</span>
      </PlateElement>
    );
  },
);
