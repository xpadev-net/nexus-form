import type { FC } from "react";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Block } from "@/types/domain/form-block";

interface BlockPreviewProps {
  /** ブロック形式の質問設定情報 */
  block: Block;
  className?: string;
}

export const BlockPreview: FC<BlockPreviewProps> = ({ block, className }) => {
  const renderQuestionComponent = () => {
    switch (block.type) {
      case "short_text":
        // TODO: Block型に移行予定
        // return <ShortTextQuestionComponent {...commonProps} block={block} />;
        return <div>Short text preview (Block migration pending)</div>;
      case "long_text":
        // TODO: Block型に移行予定
        // return <LongTextQuestionComponent {...commonProps} block={block} />;
        return <div>Long text preview (Block migration pending)</div>;
      case "radio":
        // TODO: Block型に移行予定
        // return <RadioQuestionComponent {...commonProps} block={block} />;
        return <div>Radio preview (Block migration pending)</div>;
      case "checkbox":
        // TODO: Block型に移行予定
        // return <CheckboxQuestionComponent {...commonProps} block={block} />;
        return <div>Checkbox preview (Block migration pending)</div>;
      case "dropdown":
        // TODO: Block型に移行予定
        // return <DropdownQuestionComponent {...commonProps} block={block} />;
        return <div>Dropdown preview (Block migration pending)</div>;
      case "linear_scale":
        // TODO: Block型に移行予定
        // return <LinearScaleQuestionComponent {...commonProps} block={block} />;
        return <div>Linear scale preview (Block migration pending)</div>;
      case "rating":
        // TODO: Block型に移行予定
        // return <RatingQuestionComponent {...commonProps} block={block} />;
        return <div>Rating preview (Block migration pending)</div>;
      case "choice_grid":
        // TODO: Block型に移行予定
        // return <ChoiceGridQuestionComponent {...commonProps} block={block} />;
        return <div>Choice grid preview (Block migration pending)</div>;
      case "checkbox_grid":
        // TODO: Block型に移行予定
        // return <CheckboxGridQuestionComponent {...commonProps} block={block} />;
        return <div>Checkbox grid preview (Block migration pending)</div>;
      case "date":
        // TODO: Block型に移行予定
        // return <DateQuestionComponent {...commonProps} block={block} />;
        return <div>Date preview (Block migration pending)</div>;
      case "time":
        // TODO: Block型に移行予定
        // return <TimeQuestionComponent {...commonProps} block={block} />;
        return <div>Time preview (Block migration pending)</div>;
      case "section_separator":
        // TODO: Block型に移行予定
        // return <SectionSeparatorQuestionComponent {...commonProps} block={block} />;
        return <div>Section separator preview (Block migration pending)</div>;
      default:
        return (
          <div className="p-4 text-center text-muted-foreground">
            未対応の質問タイプ: {(block as { type: string }).type}
          </div>
        );
    }
  };

  const getQuestionTypeLabel = (type: string): string => {
    const typeLabels: Record<string, string> = {
      short_text: "短文入力",
      long_text: "長文入力",
      radio: "ラジオボタン",
      checkbox: "チェックボックス",
      dropdown: "プルダウン",
      linear_scale: "均等目盛",
      rating: "評価",
      choice_grid: "選択式グリッド",
      checkbox_grid: "チェックボックスグリッド",
      date: "日付",
      time: "時刻",
      section_separator: "セクションヘッダー",
    };
    return typeLabels[type] || type;
  };

  const getQuestionTypeColor = (type: string): string => {
    const typeColors: Record<string, string> = {
      short_text: "bg-blue-100 text-blue-800",
      long_text: "bg-blue-100 text-blue-800",
      radio: "bg-green-100 text-green-800",
      checkbox: "bg-green-100 text-green-800",
      dropdown: "bg-green-100 text-green-800",
      linear_scale: "bg-purple-100 text-purple-800",
      rating: "bg-purple-100 text-purple-800",
      choice_grid: "bg-orange-100 text-orange-800",
      checkbox_grid: "bg-orange-100 text-orange-800",
      date: "bg-pink-100 text-pink-800",
      time: "bg-pink-100 text-pink-800",
      section_separator: "bg-muted text-foreground",
    };
    return typeColors[type] || "bg-muted text-foreground";
  };

  return (
    <div className={className}>
      <div className="space-y-4">
        {/* 質問ヘッダー */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Badge className={getQuestionTypeColor(block.type)}>
              {getQuestionTypeLabel(block.type)}
            </Badge>
            {block.validation.required && (
              <Badge variant="destructive">必須</Badge>
            )}
          </div>

          <h3 className="text-lg font-medium">{block.title}</h3>

          {block.description && (
            <div className="text-sm text-muted-foreground">
              <MarkdownRenderer content={block.description} />
            </div>
          )}
        </div>

        <Separator />

        {/* 質問コンポーネント */}
        <div className="bg-muted/30 p-4 rounded-lg">
          {renderQuestionComponent()}
        </div>

        {/* プレビュー情報 */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>• これは質問のプレビューです</p>
          <p>• 実際の回答は保存されません</p>
        </div>
      </div>
    </div>
  );
};

export default BlockPreview;
