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
import type {
  BlockByType,
  ShortTextValidationConfig,
} from "@/types/domain/form-block";
import type { BlockValidationEditorInternalProps } from "./types";

export const TextValidationRenderer = <T extends "short_text" | "long_text">({
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
