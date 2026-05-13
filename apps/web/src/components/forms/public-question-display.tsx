import {
  type FC,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { getShortTextPlaceholder } from "@/lib/forms/short-text-placeholder";
import { cn } from "@/lib/utils";
import {
  getValidationPatternTemplate,
  useValidationProviders,
} from "@/lib/validation/validation-providers";
import type {
  Block,
  ShortTextValidationConfig,
} from "@/types/domain/form-block";
import type {
  CheckboxWithOtherValue,
  QuestionResponseValue,
} from "@/types/forms/public-form";

interface PublicQuestionDisplayProps {
  block: Block;
  value?: QuestionResponseValue;
  onChange: (value: QuestionResponseValue) => void;
  onSectionSeparatorClick?: (block: Block) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * 公開フォーム用の質問表示コンポーネント
 * 各質問タイプに応じて適切な入力コンポーネントを表示
 */
const _PublicQuestionDisplay: FC<PublicQuestionDisplayProps> = ({
  block,
  value,
  onChange,
  onSectionSeparatorClick,
  error,
  disabled = false,
  className,
}) => {
  const derivedOtherValue =
    value != null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "type" in value &&
    value.type === "other" &&
    "value" in value &&
    typeof value.value === "string"
      ? value.value
      : "";
  const [otherValue, setOtherValue] = useState<string>(derivedOtherValue);
  const { data: validationProvidersData } = useValidationProviders();
  const validationProviders = validationProvidersData?.data ?? [];

  useEffect(() => {
    setOtherValue(derivedOtherValue);
  }, [derivedOtherValue]);

  // 短文テキスト入力
  const renderShortText = useCallback(() => {
    if (block.type !== "short_text") {
      return null;
    }

    const resolvedPlaceholder = getShortTextPlaceholder({
      validation: block.validation as ShortTextValidationConfig,
    });
    const templateInputType = block.validation.patternTemplate
      ? getValidationPatternTemplate(
          block.validation.patternTemplate,
          validationProviders,
        )?.inputType
      : undefined;
    const inputType = templateInputType ?? "text";

    return (
      <Input
        type={inputType}
        value={(value as string) || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={resolvedPlaceholder}
        className={cn(error && "border-destructive")}
      />
    );
  }, [block, value, onChange, disabled, error, validationProviders]);

  // 長文テキスト入力
  const renderLongText = useCallback(
    () => (
      <Textarea
        value={(value as string) || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="入力してください"
        className={cn(error && "border-destructive")}
        rows={4}
      />
    ),
    [value, onChange, disabled, error],
  );

  // ラジオボタン
  const renderRadio = useCallback(() => {
    if (block.type !== "radio") return null;

    const hasOther = block.validation.allowOther;
    const isOtherSelected =
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      value.type === "other";
    const currentValue =
      typeof value === "string"
        ? value
        : typeof value === "object" &&
            value !== null &&
            "type" in value &&
            value.type === "other"
          ? "other"
          : "";

    const hasValue = !!currentValue;
    const showClearButton = !block.validation.required && hasValue;

    return (
      <div className="space-y-2">
        <RadioGroup
          value={currentValue}
          onValueChange={(newValue) => {
            if (newValue === "other") {
              // "その他"が選択された場合、現在のotherValueを使用
              onChange({ type: "other", value: otherValue });
            } else {
              // 通常の選択肢が選択された場合
              onChange(newValue);
            }
          }}
          disabled={disabled}
          className="space-y-2"
        >
          {block.validation.options.map((option) => (
            <div key={option.id} className="flex items-center space-x-2">
              <RadioGroupItem
                value={option.id}
                id={`${block.blockId}-${option.id}`}
              />
              <Label
                htmlFor={`${block.blockId}-${option.id}`}
                className="text-sm"
              >
                {option.label}
              </Label>
            </div>
          ))}
          {hasOther && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="other" id={`${block.blockId}-other`} />
                <Label htmlFor={`${block.blockId}-other`} className="text-sm">
                  {block.validation.otherLabel || "その他"}
                </Label>
              </div>
              {isOtherSelected && (
                <div className="ml-6">
                  <Input
                    value={otherValue}
                    onChange={(e) => {
                      const newOtherValue = e.target.value;
                      setOtherValue(newOtherValue);
                      // 親コンポーネントに"その他"の値を伝達
                      onChange({ type: "other", value: newOtherValue });
                    }}
                    placeholder="具体的な内容を入力してください"
                    disabled={disabled}
                  />
                </div>
              )}
            </div>
          )}
        </RadioGroup>
        {showClearButton && (
          <div className="flex justify-end mt-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange("")}
              disabled={disabled}
              aria-label="選択を解除"
            >
              選択を解除
            </Button>
          </div>
        )}
      </div>
    );
  }, [block, value, onChange, disabled, otherValue]);

  // チェックボックス
  const renderCheckbox = useCallback(() => {
    if (block.type !== "checkbox") return null;

    const hasOther = block.validation.allowOther;

    // CheckboxWithOtherValue または string[] から現在の選択値を取得
    const isCheckboxOther =
      value != null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "type" in value &&
      value.type === "checkbox_other";
    const currentValues: string[] = isCheckboxOther
      ? (value as CheckboxWithOtherValue).values
      : Array.isArray(value)
        ? value
        : [];
    const isOtherSelected = currentValues.includes("other");

    // 「その他」を含む場合は CheckboxWithOtherValue を emit するヘルパー
    const emitCheckboxValue = (values: string[], currentOtherValue: string) => {
      if (values.includes("other")) {
        onChange({
          type: "checkbox_other",
          values,
          otherValue: currentOtherValue,
        });
      } else {
        onChange(values);
      }
    };

    return (
      <div className="space-y-2">
        {block.validation.options.map((option) => (
          <div key={option.id} className="flex items-center space-x-2">
            <Checkbox
              id={`${block.blockId}-${option.id}`}
              checked={currentValues.includes(option.id)}
              onCheckedChange={(checked) => {
                const nextValues = checked
                  ? [...currentValues, option.id]
                  : currentValues.filter((v) => v !== option.id);
                emitCheckboxValue(nextValues, otherValue);
              }}
              disabled={disabled}
            />
            <Label
              htmlFor={`${block.blockId}-${option.id}`}
              className="text-sm"
            >
              {option.label}
            </Label>
          </div>
        ))}
        {hasOther && (
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id={`${block.blockId}-other`}
                checked={isOtherSelected}
                onCheckedChange={(checked) => {
                  const nextValues = checked
                    ? [...currentValues, "other"]
                    : currentValues.filter((v) => v !== "other");
                  emitCheckboxValue(nextValues, otherValue);
                }}
                disabled={disabled}
              />
              <Label htmlFor={`${block.blockId}-other`} className="text-sm">
                {block.validation.otherLabel || "その他"}
              </Label>
            </div>
            {isOtherSelected && (
              <div className="ml-6">
                <Input
                  value={otherValue}
                  onChange={(e) => {
                    const newOtherValue = e.target.value;
                    setOtherValue(newOtherValue);
                    emitCheckboxValue(currentValues, newOtherValue);
                  }}
                  placeholder="具体的な内容を入力してください"
                  disabled={disabled}
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  }, [block, value, onChange, disabled, otherValue]);

  // プルダウン
  const renderDropdown = useCallback(() => {
    if (block.type !== "dropdown") return null;

    const hasOther = block.validation.allowOther;
    const isOtherSelected =
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      value.type === "other";
    const currentValue =
      typeof value === "string"
        ? value || "___NONE___"
        : typeof value === "object" &&
            value !== null &&
            "type" in value &&
            value.type === "other"
          ? "other"
          : "___NONE___";

    const isRequired = block.validation.required;

    return (
      <div className="space-y-2">
        <Select
          value={currentValue}
          onValueChange={(newValue) => {
            if (newValue === "___NONE___") {
              // "選択しない"が選択された場合
              onChange("");
            } else if (newValue === "other") {
              // "その他"が選択された場合、現在のotherValueを使用
              onChange({ type: "other", value: otherValue });
            } else {
              // 通常の選択肢が選択された場合
              onChange(newValue);
            }
          }}
          disabled={disabled}
        >
          <SelectTrigger className={cn(error && "border-destructive")}>
            <SelectValue placeholder="選択してください" />
          </SelectTrigger>
          <SelectContent>
            {!isRequired && (
              <SelectItem value="___NONE___">選択しない</SelectItem>
            )}
            {block.validation.options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
            {hasOther && (
              <SelectItem value="other">
                {block.validation.otherLabel || "その他"}
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        {hasOther && isOtherSelected && (
          <div className="ml-2">
            <Input
              value={otherValue}
              onChange={(e) => {
                const newOtherValue = e.target.value;
                setOtherValue(newOtherValue);
                // 親コンポーネントに"その他"の値を伝達
                onChange({ type: "other", value: newOtherValue });
              }}
              placeholder="具体的な内容を入力してください"
              disabled={disabled}
            />
          </div>
        )}
      </div>
    );
  }, [block, value, onChange, disabled, error, otherValue]);

  // 均等目盛
  const renderLinearScale = useCallback(() => {
    if (block.type !== "linear_scale") return null;

    const min = block.validation.min || 1;
    const max = block.validation.max || 10;
    const currentValue = (value as number) || min;

    return (
      <div className="space-y-4">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>{block.validation.minLabel || min}</span>
          <span>{block.validation.maxLabel || max}</span>
        </div>
        <div className="px-4">
          <Slider
            value={[currentValue]}
            onValueChange={([newValue]) => {
              if (newValue !== undefined) onChange(newValue);
            }}
            min={min}
            max={max}
            step={block.validation.step || 1}
            disabled={disabled}
            className="w-full"
          />
        </div>
        <div className="text-center text-sm font-medium">{currentValue}</div>
      </div>
    );
  }, [block, value, onChange, disabled]);

  // 評価（星）
  const renderRating = useCallback(() => {
    if (block.type !== "rating") return null;

    const maxRating = block.validation.maxRating || 5;
    const currentRating = (value as number) || 0;
    const icon = block.validation.icon || "star";

    const renderStar = (index: number) => {
      const isFilled = index <= currentRating;
      return (
        <button
          key={index}
          type="button"
          onClick={() => onChange(index)}
          disabled={disabled}
          className={cn(
            "text-2xl transition-colors",
            isFilled ? "text-yellow-400" : "text-muted-foreground/50",
            !disabled && "hover:text-yellow-400",
          )}
        >
          {icon === "star" && "★"}
          {icon === "heart" && "♥"}
          {icon === "thumbs" && "👍"}
        </button>
      );
    };

    return (
      <div className="flex justify-center space-x-1">
        {Array.from({ length: maxRating }, (_, index) => renderStar(index + 1))}
      </div>
    );
  }, [block, value, onChange, disabled]);

  // 日付
  const renderDate = useCallback(
    () => (
      <Input
        type="date"
        value={(value as string) || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(error && "border-destructive")}
      />
    ),
    [value, onChange, disabled, error],
  );

  // 時刻
  const renderTime = useCallback(
    () => (
      <Input
        type="time"
        value={(value as string) || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(error && "border-destructive")}
      />
    ),
    [value, onChange, disabled, error],
  );

  // 選択式グリッド
  const renderChoiceGrid = useCallback(() => {
    if (block.type !== "choice_grid") return null;

    const currentValue = (value as Record<string, string>) || {};

    return (
      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border p-2 text-left min-w-24"></th>
                {block.validation.columns.map((column) => (
                  <th
                    key={column.id}
                    className="border p-2 text-center text-xs sm:text-sm min-w-16"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.validation.rows.map((row) => (
                <tr key={row.id}>
                  <td className="border p-2 font-medium text-xs sm:text-sm">
                    {row.label}
                  </td>
                  {block.validation.columns.map((column) => (
                    <td key={column.id} className="border p-2 text-center">
                      <RadioGroup
                        value={currentValue[row.id] || ""}
                        onValueChange={(newValue) => {
                          onChange({
                            ...currentValue,
                            [row.id]: newValue,
                          });
                        }}
                        disabled={disabled}
                      >
                        <RadioGroupItem value={column.id} className="h-4 w-4" />
                      </RadioGroup>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }, [block, value, onChange, disabled]);

  // チェックボックスグリッド
  const renderCheckboxGrid = useCallback(() => {
    if (block.type !== "checkbox_grid") return null;

    const currentValue = (value as Record<string, string[]>) || {};

    return (
      <div className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border p-2 text-left min-w-24"></th>
                {block.validation.columns.map((column) => (
                  <th
                    key={column.id}
                    className="border p-2 text-center text-xs sm:text-sm min-w-16"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.validation.rows.map((row) => (
                <tr key={row.id}>
                  <td className="border p-2 font-medium text-xs sm:text-sm">
                    {row.label}
                  </td>
                  {block.validation.columns.map((column) => (
                    <td key={column.id} className="border p-2 text-center">
                      <Checkbox
                        checked={
                          currentValue[row.id]?.includes(column.id) || false
                        }
                        onCheckedChange={(checked) => {
                          const rowValues = currentValue[row.id] || [];
                          const newRowValues = checked
                            ? [...rowValues, column.id]
                            : rowValues.filter((v) => v !== column.id);

                          onChange({
                            ...currentValue,
                            [row.id]: newRowValues,
                          });
                        }}
                        disabled={disabled}
                        className="h-4 w-4"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }, [block, value, onChange, disabled]);

  // セクションヘッダー
  const renderSectionSeparator = useCallback(() => {
    if (block.type !== "section_separator") return null;

    const getButtonText = () => {
      return "次の質問に進む";
    };

    const handleClick = () => {
      if (onSectionSeparatorClick) {
        onSectionSeparatorClick(block);
      }
    };

    return (
      <div className="flex flex-col items-center space-y-4">
        <div className="text-center">
          <h3 className="text-lg font-medium">{block.title}</h3>
          {block.description && (
            <div className="text-sm text-muted-foreground mt-2">
              <MarkdownRenderer content={block.description} />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled}
          className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {getButtonText()}
        </button>
      </div>
    );
  }, [block, onSectionSeparatorClick, disabled]);

  // 質問タイプに応じたレンダリング
  const renderQuestion = useMemo(() => {
    switch (block.type) {
      case "short_text":
        return renderShortText();
      case "long_text":
        return renderLongText();
      case "radio":
        return renderRadio();
      case "checkbox":
        return renderCheckbox();
      case "dropdown":
        return renderDropdown();
      case "linear_scale":
        return renderLinearScale();
      case "rating":
        return renderRating();
      case "date":
        return renderDate();
      case "time":
        return renderTime();
      case "choice_grid":
        return renderChoiceGrid();
      case "checkbox_grid":
        return renderCheckboxGrid();
      case "section_separator":
        return renderSectionSeparator();
      default:
        return (
          <div className="text-muted-foreground">未対応の質問タイプです</div>
        );
    }
  }, [
    block.type,
    renderShortText,
    renderLongText,
    renderRadio,
    renderCheckbox,
    renderDropdown,
    renderLinearScale,
    renderRating,
    renderDate,
    renderTime,
    renderChoiceGrid,
    renderCheckboxGrid,
    renderSectionSeparator,
  ]);

  return (
    <Card className={cn("w-full", className)}>
      {/* セクションセパレーターの場合は CardHeader を表示しない */}
      {block.type !== "section_separator" && (
        <CardHeader className="pb-3">
          {block.validation.required && (
            <Badge variant="destructive" className="w-fit">
              必須
            </Badge>
          )}
          <CardTitle className="text-base sm:text-lg">
            {block.title}
            {block.validation.required && (
              <span className="sr-only">（必須）</span>
            )}
          </CardTitle>
          {block.description && (
            <div className="text-sm text-muted-foreground mt-1">
              <MarkdownRenderer content={block.description} />
            </div>
          )}
        </CardHeader>
      )}
      <CardContent className="pt-0">
        {renderQuestion}
        {error && <p className="text-sm text-destructive mt-2">{error}</p>}
      </CardContent>
    </Card>
  );
};

export const PublicQuestionDisplay = memo(_PublicQuestionDisplay);
