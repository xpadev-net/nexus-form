import { type ChangeEvent, useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CUSTOM_TEMPLATE_ID } from "@/lib/constants/validation-patterns";
import {
  getValidationPatternTemplate,
  getValidationPatternTemplates,
  useValidationProviders,
} from "@/lib/validation/validation-providers";
import {
  type BlockByType,
  type BlockType,
  type CheckboxGridValidationConfig,
  type CheckboxValidationConfig,
  DateFormat,
  type DateValidationConfig,
  type LinearScaleValidationConfig,
  type ShortTextValidationConfig,
  TimeFormat,
  type TimeValidationConfig,
} from "@/types/domain/form-block";

const normalizeLinearScaleValidation = (
  current: LinearScaleValidationConfig,
  updates: Partial<LinearScaleValidationConfig>,
): LinearScaleValidationConfig => {
  const next: LinearScaleValidationConfig = {
    ...current,
    ...updates,
  };

  if (!Number.isFinite(next.min)) {
    next.min = current.min;
  }

  if (next.max < next.min) {
    next.max = next.min;
  }

  if (next.step < 1) {
    next.step = 1;
  }

  const range = next.max - next.min;
  if (range <= 0) {
    next.step = 1;
    return next;
  }

  if (next.step > range) {
    next.step = range;
  }

  if (range % next.step !== 0) {
    next.step = 1;
  }

  return next;
};

const normalizeSelectionBounds = <
  T extends {
    min: number | undefined;
    max: number | undefined;
  },
>(
  values: T,
  changed: "min" | "max",
): T => {
  const { min, max } = values;

  if (
    typeof min === "number" &&
    typeof max === "number" &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    max < min
  ) {
    if (changed === "min") {
      return {
        ...values,
        max: min,
      };
    }

    return {
      ...values,
      min: max,
    };
  }

  return values;
};

const normalizeDateBounds = (
  current: DateValidationConfig,
  updates: Partial<DateValidationConfig>,
  changed: "min" | "max",
): DateValidationConfig => {
  const next: DateValidationConfig = {
    ...current,
    ...updates,
  };

  const { minDate, maxDate } = next;

  if (minDate && maxDate && maxDate < minDate) {
    if (changed === "min") {
      next.maxDate = minDate;
    } else {
      next.minDate = maxDate;
    }
  }

  return next;
};

const normalizeTimeBounds = (
  current: TimeValidationConfig,
  updates: Partial<TimeValidationConfig>,
  changed: "min" | "max",
): TimeValidationConfig => {
  const next: TimeValidationConfig = {
    ...current,
    ...updates,
  };

  const { minTime, maxTime } = next;

  if (minTime && maxTime && maxTime < minTime) {
    if (changed === "min") {
      next.maxTime = minTime;
    } else {
      next.minTime = maxTime;
    }
  }

  return next;
};

const parseOptionalInteger = (value: string): number | undefined => {
  if (value === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
};

interface BlockValidationEditorInternalProps<T extends BlockType> {
  question: BlockByType<T>;
  onValidationChange: (validation: BlockByType<T>["validation"]) => void;
  disabled?: boolean;
  idPrefix: string;
}

const BlockValidationEditorInner = <T extends BlockType>({
  question,
  onValidationChange,
  disabled = false,
  idPrefix,
}: BlockValidationEditorInternalProps<T>) => {
  const getValidationTitle = (): string => {
    const titles: Record<BlockType, string> = {
      short_text: "テキスト入力のバリデーション",
      long_text: "テキスト入力のバリデーション",
      radio: "選択肢のバリデーション",
      checkbox: "選択肢のバリデーション",
      dropdown: "選択肢のバリデーション",
      linear_scale: "スケールのバリデーション",
      rating: "評価のバリデーション",
      choice_grid: "グリッドのバリデーション",
      checkbox_grid: "グリッドのバリデーション",
      date: "日付のバリデーション",
      time: "時刻のバリデーション",
      section_separator: "セクションヘッダーの設定",
    };
    return titles[question.type] || "バリデーション設定";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3>{getValidationTitle()}</h3>
        <Badge variant="outline">設定可能</Badge>
      </div>

      {(question.type === "short_text" || question.type === "long_text") && (
        <TextValidationRenderer
          question={question}
          onValidationChange={onValidationChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      )}

      {(question.type === "radio" ||
        question.type === "checkbox" ||
        question.type === "dropdown") && (
        <ChoiceValidationRenderer
          question={question}
          onValidationChange={onValidationChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      )}

      {(question.type === "linear_scale" || question.type === "rating") && (
        <ScaleValidationRenderer
          question={question}
          onValidationChange={onValidationChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      )}

      {(question.type === "choice_grid" ||
        question.type === "checkbox_grid") && (
        <GridValidationRenderer
          question={question}
          onValidationChange={onValidationChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      )}

      {(question.type === "date" || question.type === "time") && (
        <DateValidationRenderer
          question={question}
          onValidationChange={onValidationChange}
          disabled={disabled}
          idPrefix={idPrefix}
        />
      )}
    </div>
  );
};

interface BlockValidationEditorProps<T extends BlockType> {
  block: BlockByType<T>;
  onValidationChange: (validation: BlockByType<T>["validation"]) => void;
  disabled?: boolean;
}

export const BlockValidationEditor = <T extends BlockType>({
  block,
  onValidationChange,
  disabled = false,
}: BlockValidationEditorProps<T>) => {
  const idPrefix = useId();

  return (
    <BlockValidationEditorInner<T>
      question={block}
      onValidationChange={onValidationChange}
      disabled={disabled}
      idPrefix={idPrefix}
    />
  );
};

export default BlockValidationEditor;

const TextValidationRenderer = <T extends "short_text" | "long_text">({
  question,
  onValidationChange,
  disabled = false,
  idPrefix,
}: BlockValidationEditorInternalProps<T>) => {
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const minLengthId = fieldId("min-length");
  const maxLengthId = fieldId("max-length");
  const patternTemplateId = fieldId("pattern-template");
  const patternId = fieldId("pattern");
  const allowPatternMismatchId = fieldId("allow-pattern-mismatch");
  const shortTextPlaceholderId = fieldId("short-text-placeholder");

  const isShortText = question.type === "short_text";
  const { data: validationProvidersData } = useValidationProviders();
  const validationProviders = validationProvidersData?.data ?? [];
  const patternTemplates = getValidationPatternTemplates(validationProviders);
  const shortTextValidation = isShortText
    ? (question.validation as ShortTextValidationConfig)
    : undefined;

  const updateShortTextValidation = (
    updater: (current: ShortTextValidationConfig) => ShortTextValidationConfig,
  ) => {
    if (!shortTextValidation) {
      return;
    }
    const next = updater(shortTextValidation);
    onValidationChange(next as BlockByType<T>["validation"]);
  };

  const selectedTemplateValue = shortTextValidation
    ? (shortTextValidation.patternTemplate ??
      (shortTextValidation.pattern ? CUSTOM_TEMPLATE_ID : ""))
    : "";

  const isCustomTemplate =
    !!shortTextValidation &&
    (shortTextValidation.patternTemplate === CUSTOM_TEMPLATE_ID ||
      (!shortTextValidation.patternTemplate && !!shortTextValidation.pattern));

  const hasTemplateLengthRestriction = (() => {
    if (
      !shortTextValidation?.patternTemplate ||
      shortTextValidation.patternTemplate === CUSTOM_TEMPLATE_ID
    ) {
      return false;
    }
    const template = getValidationPatternTemplate(
      shortTextValidation.patternTemplate,
      validationProviders,
    );
    return (
      template !== undefined &&
      (template.minLength !== undefined || template.maxLength !== undefined)
    );
  })();

  const templatePlaceholder =
    shortTextValidation?.patternTemplate &&
    shortTextValidation.patternTemplate !== CUSTOM_TEMPLATE_ID
      ? getValidationPatternTemplate(
          shortTextValidation.patternTemplate,
          validationProviders,
        )?.placeholder
      : undefined;
  const isPlaceholderLocked = !!templatePlaceholder;
  const placeholderDisplayValue =
    templatePlaceholder ?? shortTextValidation?.placeholder ?? "";

  const handlePatternTemplateChange = (templateId: string) => {
    if (!shortTextValidation) {
      return;
    }

    updateShortTextValidation((current) => {
      const normalizedId = templateId || undefined;
      const template =
        normalizedId && normalizedId !== CUSTOM_TEMPLATE_ID
          ? getValidationPatternTemplate(normalizedId, validationProviders)
          : undefined;

      let next: ShortTextValidationConfig = {
        ...current,
        patternTemplate: normalizedId,
      };

      if (normalizedId === CUSTOM_TEMPLATE_ID) {
        next = {
          ...next,
          pattern: undefined,
        };
      } else if (template) {
        next = {
          ...next,
          pattern: template.pattern ?? undefined,
          minLength: template.minLength,
          maxLength: template.maxLength,
        };
      } else {
        next = {
          ...next,
          pattern: undefined,
        };
      }

      return next;
    });
  };

  const handleCustomPatternChange = (pattern: string) => {
    if (!shortTextValidation) {
      return;
    }
    updateShortTextValidation((current) => ({
      ...current,
      pattern: pattern || undefined,
    }));
  };

  const handlePlaceholderChange = (value: string) => {
    if (!shortTextValidation) {
      return;
    }

    updateShortTextValidation((current) => ({
      ...current,
      placeholder: value === "" ? undefined : value,
    }));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={minLengthId}>最小文字数</Label>
          <Input
            id={minLengthId}
            type="number"
            value={question.validation.minLength || ""}
            onChange={(e) =>
              onValidationChange({
                ...question.validation,
                minLength: e.target.value
                  ? parseInt(e.target.value, 10)
                  : undefined,
              })
            }
            placeholder="0"
            min="0"
            disabled={disabled || hasTemplateLengthRestriction}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={maxLengthId}>最大文字数</Label>
          <Input
            id={maxLengthId}
            type="number"
            value={question.validation.maxLength || ""}
            onChange={(e) =>
              onValidationChange({
                ...question.validation,
                maxLength: e.target.value
                  ? parseInt(e.target.value, 10)
                  : undefined,
              })
            }
            placeholder="1000"
            min="1"
            disabled={disabled || hasTemplateLengthRestriction}
          />
        </div>
      </div>

      {question.type === "short_text" && shortTextValidation && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={patternTemplateId}>パターンテンプレート</Label>
            <Select
              value={selectedTemplateValue}
              onValueChange={handlePatternTemplateChange}
              disabled={disabled}
            >
              <SelectTrigger id={patternTemplateId}>
                <SelectValue placeholder="テンプレートを選択してください" />
              </SelectTrigger>
              <SelectContent>
                {patternTemplates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    <div className="flex flex-col">
                      <span className="text-left">{template.displayName}</span>
                      <span className="text-xs text-muted-foreground text-left">
                        {template.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              事前定義されたパターンから選択するか、カスタムで正規表現を入力できます
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={patternId}>正規表現パターン</Label>
            <Input
              id={patternId}
              value={shortTextValidation.pattern?.toString() || ""}
              onChange={(e) => handleCustomPatternChange(e.target.value)}
              placeholder={
                isCustomTemplate
                  ? "例: ^[a-zA-Z0-9]+$"
                  : shortTextValidation.patternTemplate
                    ? getValidationPatternTemplate(
                        shortTextValidation.patternTemplate,
                        validationProviders,
                      )?.placeholder || "例: ^[a-zA-Z0-9]+$"
                    : "例: ^[a-zA-Z0-9]+$"
              }
              disabled={!isCustomTemplate}
            />
            <p className="text-xs text-muted-foreground">
              {isCustomTemplate
                ? "入力値がこの正規表現に一致する必要があります"
                : "テンプレートを選択すると自動的に正規表現が設定されます"}
            </p>
          </div>

          {(shortTextValidation.pattern ||
            shortTextValidation.patternTemplate) && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Switch
                  id={allowPatternMismatchId}
                  checked={shortTextValidation.allowPatternMismatch || false}
                  onCheckedChange={(checked) =>
                    updateShortTextValidation((current) => ({
                      ...current,
                      allowPatternMismatch: checked,
                    }))
                  }
                  disabled={disabled}
                />
                <Label htmlFor={allowPatternMismatchId}>
                  パターン不一致を許容
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                有効にすると、正規表現パターンに一致しない入力でもエラーになりません
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={shortTextPlaceholderId}>プレースホルダー</Label>
            <Input
              id={shortTextPlaceholderId}
              value={placeholderDisplayValue}
              onChange={(event) => handlePlaceholderChange(event.target.value)}
              placeholder="例: ご希望のユーザー名"
              disabled={disabled || isPlaceholderLocked}
            />
            <p className="text-xs text-muted-foreground">
              {isPlaceholderLocked
                ? `テンプレートで定義された「${templatePlaceholder}」がプレースホルダーとして使用されます。テンプレートを解除するとカスタム値を編集できます。`
                : "入力すると回答画面のプレースホルダーが上書きされ、空欄に戻すと自動生成にフォールバックします"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

const ChoiceValidationRenderer = <T extends "checkbox" | "radio" | "dropdown">({
  question,
  onValidationChange,
  disabled = false,
  idPrefix,
}: BlockValidationEditorInternalProps<T>) => {
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const minSelectionsId = fieldId("min-selections");
  const maxSelectionsId = fieldId("max-selections");
  const allowOtherId = fieldId("allow-other");
  const otherLabelId = fieldId("other-label");

  const renderCheckboxRangeControls = () => {
    if (question.type !== "checkbox") {
      return null;
    }

    const checkboxValidation: CheckboxValidationConfig = question.validation;

    const handleMinSelectionsChange = (
      event: ChangeEvent<HTMLInputElement>,
    ) => {
      const nextMin = parseOptionalInteger(event.target.value);
      const normalized = normalizeSelectionBounds(
        {
          min: nextMin,
          max: checkboxValidation.maxSelections,
        },
        "min",
      );

      onValidationChange({
        ...checkboxValidation,
        minSelections: normalized.min,
        maxSelections: normalized.max,
      });
    };

    const handleMaxSelectionsChange = (
      event: ChangeEvent<HTMLInputElement>,
    ) => {
      const nextMax = parseOptionalInteger(event.target.value);
      const normalized = normalizeSelectionBounds(
        {
          min: checkboxValidation.minSelections,
          max: nextMax,
        },
        "max",
      );

      onValidationChange({
        ...checkboxValidation,
        minSelections: normalized.min,
        maxSelections: normalized.max,
      });
    };

    return (
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={minSelectionsId}>最小選択数</Label>
          <Input
            id={minSelectionsId}
            type="number"
            value={checkboxValidation.minSelections ?? ""}
            onChange={handleMinSelectionsChange}
            placeholder="0"
            min={0}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={maxSelectionsId}>最大選択数</Label>
          <Input
            id={maxSelectionsId}
            type="number"
            value={checkboxValidation.maxSelections ?? ""}
            onChange={handleMaxSelectionsChange}
            placeholder="無制限"
            min={Math.max(1, checkboxValidation.minSelections ?? 1)}
            disabled={disabled}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {question.type === "checkbox" && renderCheckboxRangeControls()}

      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Switch
            id={allowOtherId}
            checked={question.validation.allowOther || false}
            onCheckedChange={(checked) =>
              onValidationChange({
                ...question.validation,
                allowOther: checked,
              })
            }
            disabled={disabled}
          />
          <Label htmlFor={allowOtherId}>「その他」オプションを追加</Label>
        </div>
        {question.validation.allowOther && (
          <div className="space-y-2">
            <Label htmlFor={otherLabelId}>「その他」ラベル</Label>
            <Input
              id={otherLabelId}
              value={question.validation.otherLabel || "その他"}
              onChange={(e) =>
                onValidationChange({
                  ...question.validation,
                  otherLabel: e.target.value,
                })
              }
              placeholder="その他"
              disabled={disabled}
            />
          </div>
        )}
      </div>
    </div>
  );
};

const ScaleValidationRenderer = <T extends "linear_scale" | "rating">({
  question,
  onValidationChange,
  disabled = false,
  idPrefix,
}: BlockValidationEditorInternalProps<T>) => {
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const scaleMinId = fieldId("scale-min");
  const scaleMaxId = fieldId("scale-max");
  const minLabelId = fieldId("min-label");
  const maxLabelId = fieldId("max-label");
  const stepId = fieldId("step");
  const maxRatingId = fieldId("max-rating");
  const ratingIconId = fieldId("rating-icon");

  if (question.type === "linear_scale") {
    const linearValidation = question.validation;

    const handleMinChange = (event: ChangeEvent<HTMLInputElement>) => {
      const parsed = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(parsed)) {
        onValidationChange(linearValidation);
        return;
      }

      onValidationChange(
        normalizeLinearScaleValidation(linearValidation, {
          min: parsed,
        }),
      );
    };

    const handleMaxChange = (event: ChangeEvent<HTMLInputElement>) => {
      const parsed = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(parsed)) {
        onValidationChange(linearValidation);
        return;
      }

      onValidationChange(
        normalizeLinearScaleValidation(linearValidation, {
          max: parsed,
        }),
      );
    };

    const handleStepChange = (event: ChangeEvent<HTMLInputElement>) => {
      const parsed = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(parsed)) {
        onValidationChange(linearValidation);
        return;
      }

      onValidationChange(
        normalizeLinearScaleValidation(linearValidation, {
          step: parsed,
        }),
      );
    };

    const maxStepRange = linearValidation.max - linearValidation.min;

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={scaleMinId}>最小値</Label>
            <Input
              id={scaleMinId}
              type="number"
              value={linearValidation.min}
              onChange={handleMinChange}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={scaleMaxId}>最大値</Label>
            <Input
              id={scaleMaxId}
              type="number"
              value={linearValidation.max}
              onChange={handleMaxChange}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={minLabelId}>最小値ラベル</Label>
            <Input
              id={minLabelId}
              value={linearValidation.minLabel || ""}
              onChange={(event) =>
                onValidationChange({
                  ...linearValidation,
                  minLabel: event.target.value || undefined,
                })
              }
              placeholder="例: 全く当てはまらない"
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={maxLabelId}>最大値ラベル</Label>
            <Input
              id={maxLabelId}
              value={linearValidation.maxLabel || ""}
              onChange={(event) =>
                onValidationChange({
                  ...linearValidation,
                  maxLabel: event.target.value || undefined,
                })
              }
              placeholder="例: 非常に当てはまる"
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={stepId}>ステップ</Label>
          <Input
            id={stepId}
            type="number"
            value={linearValidation.step || 1}
            onChange={handleStepChange}
            min={1}
            max={maxStepRange > 0 ? maxStepRange : undefined}
            disabled={disabled}
          />
        </div>
      </div>
    );
  }

  if (question.type === "rating") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={maxRatingId}>最大評価</Label>
          <Input
            id={maxRatingId}
            type="number"
            value={question.validation.maxRating || 5}
            onChange={(e) =>
              onValidationChange({
                ...question.validation,
                maxRating: parseInt(e.target.value, 10) || 5,
              })
            }
            min="1"
            max="10"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={ratingIconId}>アイコン</Label>
          <Select
            value={question.validation.icon || "star"}
            onValueChange={(value) =>
              onValidationChange({
                ...question.validation,
                icon: value as "star" | "heart" | "thumbs",
              })
            }
            disabled={disabled}
          >
            <SelectTrigger id={ratingIconId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="star">星</SelectItem>
              <SelectItem value="heart">ハート</SelectItem>
              <SelectItem value="thumbs">サムズアップ</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return null;
};

const GridValidationRenderer = <T extends "choice_grid" | "checkbox_grid">({
  question,
  onValidationChange,
  disabled = false,
  idPrefix,
}: BlockValidationEditorInternalProps<T>) => {
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const minSelectionsPerRowId = fieldId("min-selections-per-row");
  const maxSelectionsPerRowId = fieldId("max-selections-per-row");
  const validation = question.validation;

  if (question.type === "checkbox_grid") {
    const checkboxGridValidation = validation as CheckboxGridValidationConfig;
    const handleMinPerRowChange = (event: ChangeEvent<HTMLInputElement>) => {
      const nextMin = parseOptionalInteger(event.target.value);
      const normalized = normalizeSelectionBounds(
        {
          min: nextMin,
          max: checkboxGridValidation.maxSelectionsPerRow,
        },
        "min",
      );

      onValidationChange({
        ...checkboxGridValidation,
        minSelectionsPerRow: normalized.min,
        maxSelectionsPerRow: normalized.max,
      });
    };

    const handleMaxPerRowChange = (event: ChangeEvent<HTMLInputElement>) => {
      const nextMax = parseOptionalInteger(event.target.value);
      const normalized = normalizeSelectionBounds(
        {
          min: checkboxGridValidation.minSelectionsPerRow,
          max: nextMax,
        },
        "max",
      );

      onValidationChange({
        ...checkboxGridValidation,
        minSelectionsPerRow: normalized.min,
        maxSelectionsPerRow: normalized.max,
      });
    };

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={minSelectionsPerRowId}>行あたり最小選択数</Label>
            <Input
              id={minSelectionsPerRowId}
              type="number"
              value={checkboxGridValidation.minSelectionsPerRow ?? ""}
              onChange={handleMinPerRowChange}
              placeholder="0"
              min={0}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={maxSelectionsPerRowId}>行あたり最大選択数</Label>
            <Input
              id={maxSelectionsPerRowId}
              type="number"
              value={checkboxGridValidation.maxSelectionsPerRow ?? ""}
              onChange={handleMaxPerRowChange}
              placeholder="無制限"
              min={Math.max(1, checkboxGridValidation.minSelectionsPerRow ?? 1)}
              disabled={disabled}
            />
          </div>
        </div>
      </div>
    );
  }

  return null;
};

const DateValidationRenderer = <T extends "date" | "time">({
  question,
  onValidationChange,
  disabled = false,
  idPrefix,
}: BlockValidationEditorInternalProps<T>) => {
  const fieldId = (field: string) => `${idPrefix}-${field}`;
  const minDateId = fieldId("min-date");
  const maxDateId = fieldId("max-date");
  const dateFormatId = fieldId("date-format");
  const minTimeId = fieldId("min-time");
  const maxTimeId = fieldId("max-time");
  const timeFormatId = fieldId("time-format");

  if (question.type === "date") {
    const dateValidation: DateValidationConfig = question.validation;

    const handleMinDateChange = (event: ChangeEvent<HTMLInputElement>) => {
      const next = normalizeDateBounds(
        dateValidation,
        { minDate: event.target.value || undefined },
        "min",
      );

      onValidationChange(next);
    };

    const handleMaxDateChange = (event: ChangeEvent<HTMLInputElement>) => {
      const next = normalizeDateBounds(
        dateValidation,
        { maxDate: event.target.value || undefined },
        "max",
      );

      onValidationChange(next);
    };

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={minDateId}>最小日付</Label>
            <Input
              id={minDateId}
              type="date"
              value={dateValidation.minDate || ""}
              onChange={handleMinDateChange}
              max={dateValidation.maxDate}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={maxDateId}>最大日付</Label>
            <Input
              id={maxDateId}
              type="date"
              value={dateValidation.maxDate || ""}
              onChange={handleMaxDateChange}
              min={dateValidation.minDate}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={dateFormatId}>日付形式</Label>
          <Select
            value={question.validation.format || "YYYY-MM-DD"}
            onValueChange={(value) => {
              onValidationChange({
                ...question.validation,
                format: DateFormat.parse(value),
              });
            }}
          >
            <SelectTrigger id={dateFormatId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
              <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
              <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (question.type === "time") {
    const timeValidation: TimeValidationConfig = question.validation;

    const handleMinTimeChange = (event: ChangeEvent<HTMLInputElement>) => {
      const next = normalizeTimeBounds(
        timeValidation,
        { minTime: event.target.value || undefined },
        "min",
      );

      onValidationChange(next);
    };

    const handleMaxTimeChange = (event: ChangeEvent<HTMLInputElement>) => {
      const next = normalizeTimeBounds(
        timeValidation,
        { maxTime: event.target.value || undefined },
        "max",
      );

      onValidationChange(next);
    };

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={minTimeId}>最小時刻</Label>
            <Input
              id={minTimeId}
              type="time"
              value={timeValidation.minTime || ""}
              onChange={handleMinTimeChange}
              max={timeValidation.maxTime || undefined}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={maxTimeId}>最大時刻</Label>
            <Input
              id={maxTimeId}
              type="time"
              value={timeValidation.maxTime || ""}
              onChange={handleMaxTimeChange}
              min={timeValidation.minTime || undefined}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={timeFormatId}>時刻形式</Label>
          <Select
            value={question.validation.format || "24h"}
            onValueChange={(value) =>
              onValidationChange({
                ...question.validation,
                format: TimeFormat.parse(value),
              })
            }
          >
            <SelectTrigger id={timeFormatId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">24時間形式</SelectItem>
              <SelectItem value="12h">12時間形式</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return null;
};
