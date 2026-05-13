import { Plus } from "lucide-react";
import { type FC, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { BlockType } from "@/types/domain/form-block";
import { BlockTypePalette } from "./block-type-palette";

interface BlockAddModalProps {
  onAddBlock: (type: BlockType, position?: number) => void;
  children?: ReactNode;
  /** カスタムボタンのスタイルクラス */
  buttonClassName?: string;
}

export const BlockAddModal: FC<BlockAddModalProps> = ({
  onAddBlock,
  children,
  buttonClassName,
}) => {
  const [open, setOpen] = useState(false);

  const handleSelectType = (type: BlockType) => {
    onAddBlock(type);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children || (
          <Button className={buttonClassName}>
            <Plus className="h-4 w-4 mr-2" />
            質問を追加
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>質問の種類を選択</DialogTitle>
          <DialogDescription>
            追加したい質問の種類を選択してください。
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <BlockTypePalette onSelectType={handleSelectType} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BlockAddModal;
