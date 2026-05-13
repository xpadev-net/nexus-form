import { cn } from "@udecode/cn";
import { useBlockSelected } from "@platejs/selection/react";
import type { FC } from "react";

export const BlockSelection: FC<{
  className?: string;
}> = ({ className }) => {
  const isBlockSelected = useBlockSelected();

  if (!isBlockSelected) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-[1] bg-brand/[.13]",
        className,
      )}
    />
  );
};
