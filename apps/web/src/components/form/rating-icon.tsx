import type { FC } from "react";
import { cn } from "@/lib/utils";

interface RatingIconProps {
  type: "star" | "heart" | "thumbs";
  isActive: boolean;
  isHovered: boolean;
  disabled?: boolean;
  size?: number;
}

/**
 * 評価用アイコンコンポーネント
 * 星、ハート、サムズアップのアイコンを表示
 */
export const RatingIcon: FC<RatingIconProps> = ({
  type,
  isActive,
  isHovered,
  disabled = false,
  size = 8,
}) => {
  const sizeClasses: Record<number, string> = {
    4: "h-4 w-4",
    6: "h-6 w-6",
    8: "h-8 w-8",
    10: "h-10 w-10",
    12: "h-12 w-12",
  };
  const sizeClass = sizeClasses[size] ?? "h-8 w-8";
  const baseClasses = cn(
    `${sizeClass} transition-all duration-200 cursor-pointer`,
    disabled && "cursor-not-allowed opacity-50",
    isActive && "scale-110",
    isHovered && !disabled && "scale-105",
  );

  switch (type) {
    case "star":
      return (
        <svg
          className={cn(
            baseClasses,
            isActive
              ? "text-yellow-400 fill-current"
              : "text-muted-foreground/50 hover:text-yellow-300",
          )}
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      );
    case "heart":
      return (
        <svg
          className={cn(
            baseClasses,
            isActive
              ? "text-red-500 fill-current"
              : "text-muted-foreground/50 hover:text-red-300",
          )}
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
      );
    case "thumbs":
      return (
        <svg
          className={cn(
            baseClasses,
            isActive
              ? "text-green-500 fill-current"
              : "text-muted-foreground/50 hover:text-green-300",
          )}
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3v11z" />
        </svg>
      );
    default:
      return (
        <div
          className={cn(
            baseClasses,
            "rounded-full border-2",
            isActive
              ? "bg-blue-500 border-blue-500 text-primary-foreground"
              : "border-border hover:border-blue-300 hover:bg-blue-50",
          )}
        >
          <span className="text-sm font-medium">{type}</span>
        </div>
      );
  }
};
