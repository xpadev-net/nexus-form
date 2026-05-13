import { type FC, useState } from "react";
import { Button } from "@/components/ui/button";
import type { BlockType } from "@/types/domain/form-block";
import { BLOCK_TYPES } from "./block-types";

// ブロックタイプ選択パレットコンポーネント
interface BlockTypePaletteProps {
  onSelectType: (type: BlockType) => void;
}

export const BlockTypePalette: FC<BlockTypePaletteProps> = ({
  onSelectType,
}) => {
  const categories = [
    "text",
    "choice",
    "scale",
    "grid",
    "date",
    "layout",
    "system",
  ] as const;
  const categoryLabels = {
    text: "テキスト入力",
    choice: "選択式",
    scale: "評価・スケール",
    grid: "グリッド",
    date: "日時",
    layout: "レイアウト",
    system: "システム",
  };

  const [selectedCategory, setSelectedCategory] = useState<
    (typeof categories)[number]
  >(categories[0]);

  const types = BLOCK_TYPES.filter((qt) => qt.category === selectedCategory);

  return (
    <div className="md:grid md:grid-cols-[220px_1fr] md:gap-6">
      {/* カテゴリメニュー - モバイルは横スクロール、デスクトップは縦並び */}
      <nav className="md:sticky md:top-0 md:self-start mb-4 md:mb-0">
        <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible pb-2 md:pb-0">
          {categories.map((category) => (
            <Button
              key={category}
              type="button"
              variant={selectedCategory === category ? "default" : "ghost"}
              onClick={() => setSelectedCategory(category)}
              aria-current={selectedCategory === category ? "true" : undefined}
              className={`text-left whitespace-nowrap md:whitespace-normal justify-start${selectedCategory !== category ? " text-muted-foreground" : ""}`}
            >
              {categoryLabels[category]}
            </Button>
          ))}
        </div>
      </nav>

      {/* ブロックタイプ一覧 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {types.map((questionType) => {
          const Icon = questionType.icon;
          return (
            <Button
              key={questionType.type}
              variant="outline"
              className="justify-start h-auto p-3"
              onClick={() => onSelectType(questionType.type)}
              data-testid={`question-type-${questionType.type}`}
            >
              <div className="flex items-center gap-3 w-full">
                <Icon className="h-4 w-4 text-primary flex-shrink-0" />
                <div className="text-left flex-1 min-w-0 whitespace-normal">
                  <div className="font-medium text-sm">
                    {questionType.label}
                  </div>
                  <div className="text-xs text-muted-foreground break-words">
                    {questionType.description}
                  </div>
                </div>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
};
