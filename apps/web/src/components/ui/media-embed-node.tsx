import { cn, withRef } from "@udecode/cn";
import { useMediaState } from "@platejs/media/react";
import { PlateElement, useSelected } from "platejs/react";

export const MediaEmbedElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const { unsafeUrl } = useMediaState();
    const selected = useSelected();

    return (
      <PlateElement
        ref={ref}
        className={cn("relative my-2 py-2.5", className)}
        {...props}
      >
        <figure className="group relative m-0 w-full">
          <div
            className={cn(
              "relative w-full overflow-hidden rounded-sm",
              selected && "ring-2 ring-ring ring-offset-2",
            )}
          >
            <div className="relative aspect-video w-full">
              <iframe
                src={unsafeUrl}
                title={unsafeUrl}
                className="absolute inset-0 size-full"
                allowFullScreen
                sandbox="allow-same-origin allow-scripts allow-popups"
              />
            </div>
          </div>
        </figure>
        {children}
      </PlateElement>
    );
  },
);
