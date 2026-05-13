import { cn, withRef } from "@udecode/cn";
import {
  useFloatingLinkEdit,
  useFloatingLinkEditState,
  useFloatingLinkInsert,
  useFloatingLinkInsertState,
  useFloatingLinkUrlInput,
  useFloatingLinkUrlInputState,
  useLinkOpenButtonState,
} from "@platejs/link/react";
import { ExternalLinkIcon, LinkIcon, UnlinkIcon } from "lucide-react";
import type { TElement } from "platejs";
import { PlateElement, useElement } from "platejs/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const LinkElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const element = useElement<TElement>();

    return (
      <PlateElement
        ref={ref}
        as="a"
        className={cn(
          "font-medium text-primary underline decoration-primary underline-offset-4",
          className,
        )}
        {...((element as Record<string, unknown>).url
          ? {
              href: (element as Record<string, unknown>).url as string,
              target: "_blank",
              rel: "noopener noreferrer",
            }
          : {})}
        {...props}
      >
        {children}
      </PlateElement>
    );
  },
);

export function LinkFloatingToolbar() {
  const insertState = useFloatingLinkInsertState();
  const insertResult = useFloatingLinkInsert(insertState);

  const editState = useFloatingLinkEditState();
  const editResult = useFloatingLinkEdit(editState);

  if (insertState.isOpen) {
    return <LinkFloatingInsert {...insertResult} />;
  }

  if (editState.isOpen) {
    return <LinkFloatingEdit {...editResult} />;
  }

  return null;
}

function LinkFloatingInsert({
  ref: floatingRef,
  props: floatingProps,
  textInputProps,
  hidden,
}: ReturnType<typeof useFloatingLinkInsert>) {
  const urlInputState = useFloatingLinkUrlInputState();
  const { props: urlInputProps, ref: urlInputRef } =
    useFloatingLinkUrlInput(urlInputState);

  if (hidden) return null;

  return (
    <div
      ref={floatingRef}
      className="z-50 w-[330px] rounded-md border bg-popover p-2 shadow-md"
      {...floatingProps}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <LinkIcon className="size-4 text-muted-foreground" />
          <Input
            ref={urlInputRef}
            className="h-8 flex-1"
            placeholder="Paste link"
            {...urlInputProps}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Text</span>
          <Input
            className="h-8 flex-1"
            placeholder="Text to display"
            {...textInputProps}
          />
        </div>
      </div>
    </div>
  );
}

function LinkFloatingEdit({
  ref: floatingRef,
  props: floatingProps,
  editButtonProps,
  unlinkButtonProps,
}: ReturnType<typeof useFloatingLinkEdit>) {
  const { element } = useLinkOpenButtonState();

  return (
    <div
      ref={floatingRef}
      className="z-50 flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md"
      {...floatingProps}
    >
      <Button variant="ghost" size="icon-sm" asChild>
        <a
          href={
            (element as unknown as Record<string, string>)?.url
          }
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLinkIcon className="size-4" />
        </a>
      </Button>
      <Button variant="ghost" size="icon-sm" {...editButtonProps}>
        <LinkIcon className="size-4" />
      </Button>
      <Button variant="ghost" size="icon-sm" {...unlinkButtonProps}>
        <UnlinkIcon className="size-4" />
      </Button>
    </div>
  );
}
