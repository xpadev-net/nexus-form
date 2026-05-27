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

// Block dangerous URI schemes that execute code. Normalize away invisible
// control characters (tabs, zero-width spaces, soft hyphens, etc.) before
// checking so "java​script:" style bypass attempts are also caught.
const BLOCKED_PROTOCOLS = /^(javascript|vbscript|data):/i;

function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url
    .trim()
    .replace(/[\x00-\x1f\x7f\u00ad\u200b-\u200d\u2028\u2029\ufeff]+/g, "")
    .trim();
  if (BLOCKED_PROTOCOLS.test(trimmed)) return undefined;
  return trimmed;
}

interface LinkTElement extends TElement {
  url?: string;
}

export const LinkElement = withRef<typeof PlateElement>(
  ({ children, className, ...props }, ref) => {
    const element = useElement<LinkTElement>();
    const safeUrl = sanitizeUrl(element.url);

    return (
      <PlateElement
        ref={ref}
        as="a"
        className={cn(
          "font-medium text-primary underline decoration-primary underline-offset-4",
          className,
        )}
        {...(safeUrl
          ? {
              href: safeUrl,
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
  const safeUrl = sanitizeUrl((element as LinkTElement).url);

  return (
    <div
      ref={floatingRef}
      className="z-50 flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md"
      {...floatingProps}
    >
      <Button variant="ghost" size="icon-sm" asChild aria-label="リンクを開く">
        <a href={safeUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLinkIcon className="size-4" />
        </a>
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="リンクを編集" {...editButtonProps}>
        <LinkIcon className="size-4" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="リンクを解除" {...unlinkButtonProps}>
        <UnlinkIcon className="size-4" />
      </Button>
    </div>
  );
}
