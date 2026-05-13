import { Plus } from "lucide-react";
import { type FC, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BlockType } from "@/types/domain/form-block";
import BlockAddModal from "./block-add-modal";

interface BlockInsertButtonProps {
  /** ブロック追加時のコールバック */
  onAddBlock: (type: BlockType, position?: number) => void;
  /** 挿入位置（ブロックのインデックス） */
  position?: number;
  /** ドラッグ中かどうか */
  isDragging?: boolean;
  /** カスタムクラス名 */
  className?: string;
}

export const BlockInsertButton: FC<BlockInsertButtonProps> = ({
  onAddBlock,
  position,
  isDragging = false,
  className,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  // ドラッグ中は表示しない
  if (isDragging) {
    return null;
  }

  const handleAddBlock = (type: BlockType) => {
    onAddBlock(type, position);
  };

  return (
    <section
      className={cn(
        "group relative py-2 transition-all duration-200",
        "hover:bg-accent/5 focus-within:bg-accent/5",
        "min-h-[2rem] flex items-center justify-center",
        className,
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onTouchStart={() => setIsHovered(true)}
      onTouchEnd={() => setIsHovered(false)}
      aria-label="ブロック挿入エリア"
    >
      {/* ホバー時の挿入線 */}
      <div
        className={cn(
          "absolute left-0 right-0 top-1/2 h-0 transition-all duration-200",
          isHovered
            ? "border-t-2 border-dashed border-primary"
            : "border-t border-dashed border-transparent",
        )}
      />

      {/* 挿入ボタン */}
      <div className="flex justify-center">
        <BlockAddModal onAddBlock={handleAddBlock}>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "transition-all duration-200",
              "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
              "focus-visible:opacity-100",
              "hover:bg-primary/10 hover:text-primary",
              "focus-visible:bg-primary/10 focus-visible:text-primary",
              "h-8 px-3 text-sm",
            )}
            aria-label="ブロックを追加"
          >
            <Plus className="h-4 w-4 mr-1" />
            ブロックを追加
          </Button>
        </BlockAddModal>
      </div>
    </section>
  );
};

export default BlockInsertButton;
