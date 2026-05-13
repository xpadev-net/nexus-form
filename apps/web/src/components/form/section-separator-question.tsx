import { ArrowRight, Navigation } from "lucide-react";
import type { FC } from "react";
import type { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { FORM_NAV } from "@/lib/constants/forms";
import type { SectionSeparatorFormBlock } from "@/types/domain/form-block";

interface SectionSeparatorQuestionComponentProps {
  /** ブロック形式の質問設定情報 */
  block: z.infer<typeof SectionSeparatorFormBlock>;
  value?: string;
  onChange?: (value: string) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export const SectionSeparatorQuestionComponent: FC<
  SectionSeparatorQuestionComponentProps
> = ({ block, value: _value, onChange, error, disabled, className }) => {
  if (block.type !== "section_separator") {
    throw new Error("Invalid block type for SectionSeparatorQuestionComponent");
  }

  const handleSkip = () => {
    if (onChange) {
      onChange(FORM_NAV.NEXT);
    }
  };

  return (
    <div className={className}>
      <Card className="border-dashed border-2 border-muted-foreground/20">
        <CardContent className="p-6">
          <div className="flex flex-col items-center space-y-4 text-center">
            <div className="flex items-center space-x-2 text-muted-foreground">
              <Navigation className="h-5 w-5" />
              <span className="text-sm font-medium">セクションヘッダー</span>
            </div>

            <Separator className="w-16" />

            <div className="space-y-2">
              <h3 className="text-lg font-medium">{block.title}</h3>
              {block.description && (
                <p className="text-sm text-muted-foreground">
                  {block.description}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Badge variant="outline" className="text-xs">
                セクションヘッダー
              </Badge>
              <p className="text-sm text-muted-foreground">
                次のセクションに進みます
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSkip}
                disabled={disabled}
                className="text-xs"
              >
                <ArrowRight className="h-3 w-3 mr-1" />
                次へ進む
              </Button>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SectionSeparatorQuestionComponent;
