import { cn, withRef } from "@udecode/cn";
import { useMediaState } from "@platejs/media/react";
import {
  Resizable,
  ResizableProvider,
  ResizeHandle,
} from "@platejs/resizable";
import { PlateElement, useSelected } from "platejs/react";

export const ImageElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const { unsafeUrl, align } = useMediaState();
    const selected = useSelected();

    return (
      <PlateElement
        ref={ref}
        className={cn("my-2 py-2.5", className)}
        {...props}
      >
        <figure className="group relative m-0 inline-block w-full">
          <ResizableProvider>
            <Resizable
              options={{
                align: align ?? "center",
              }}
            >
              <ResizeHandle
                options={{ direction: "left" }}
                className={cn(
                  "absolute top-0 left-0 z-10 h-full w-2 cursor-col-resize",
                  !selected && "opacity-0",
                )}
              />
              <img
                src={unsafeUrl}
                alt=""
                className={cn(
                  "block w-full max-w-full cursor-default rounded-sm object-cover",
                  selected && "ring-2 ring-ring ring-offset-2",
                )}
                draggable={false}
              />
              <ResizeHandle
                options={{ direction: "right" }}
                className={cn(
                  "absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize",
                  !selected && "opacity-0",
                )}
              />
            </Resizable>
          </ResizableProvider>
        </figure>

        {children}
      </PlateElement>
    );
  },
);
