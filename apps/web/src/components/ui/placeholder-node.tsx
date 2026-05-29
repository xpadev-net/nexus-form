import { cn, withRef } from "@udecode/cn";
import { usePlaceholderElementState } from "@platejs/media/react";
import { FileUpIcon, FilmIcon, ImageIcon, MusicIcon } from "lucide-react";
import { PlateElement } from "platejs/react";

const PLACEHOLDER_ICONS: Record<string, typeof ImageIcon> = {
  image: ImageIcon,
  video: FilmIcon,
  audio: MusicIcon,
  file: FileUpIcon,
};

export const MediaPlaceholderElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const { mediaType, isUploading, progresses, selected } =
      usePlaceholderElementState();

    const IconComponent = PLACEHOLDER_ICONS[mediaType] ?? FileUpIcon;
    const progressValues = Object.values(progresses) as number[];
    const progress =
      progressValues.length > 0
        ? progressValues.reduce((a, b) => a + b, 0) / progressValues.length
        : 0;

    return (
      <PlateElement
        ref={ref}
        className={cn("my-2 py-2", className)}
        {...props}
      >
        <div
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 transition-colors hover:border-muted-foreground/50",
            selected && "border-ring ring-2 ring-ring ring-offset-2",
            isUploading && "pointer-events-none",
          )}
          contentEditable={false}
        >
          <IconComponent className="mb-2 size-8 text-muted-foreground" />
          {isUploading ? (
            <div className="flex w-full max-w-[200px] flex-col items-center gap-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                {Math.round(progress)}%
              </span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              Drop {mediaType} here or click to upload
            </span>
          )}
        </div>
        {children}
      </PlateElement>
    );
  },
);
