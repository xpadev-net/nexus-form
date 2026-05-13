import {
  extractTitleFromChildren,
} from "@nexus-form/shared";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { TElement } from "platejs";
import { useEditorRef, useElement } from "platejs/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { LogicActionBuilder } from "@/components/forms/logic-action-builder";
import { LogicConditionBuilder } from "@/components/forms/logic-condition-builder";
import { Button } from "@/components/ui/button";
import { CompositionAwareInput } from "@/components/ui/composition-aware-input";
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
import type { BlockType } from "@/types/domain/form-block";
import { getBlockTypeDisplayName } from "@/utils/block-type-converter";
import { CUSTOM_TEMPLATE_ID } from "@/lib/constants/validation-patterns";
import {
  getValidationPatternTemplate,
  getValidationPatternTemplates,
  useValidationProviders,
} from "@/lib/validation/validation-providers";
import type { PlateSectionContext } from "@/hooks/forms/use-plate-section-context";
import type { SectionTransitionAction } from "@/types/domain/form-block";
import type {
  FormLogicAction,
  FormLogicCondition,
  FormLogicRule,
} from "@/types/validation/form";

// ---------------------------------------------------------------------------
// Hook: useUpdateValidation
// ---------------------------------------------------------------------------

type ValidationRecord = Record<string, unknown>;

/**
 * Returns a stable callback that merges partial validation data into
 * the current element's `validation` property via Plate's setNodes API.
 */
export function useUpdateValidation() {
  const editor = useEditorRef();
  const element = useElement<TElement>();

  return useCallback(
    (patch: ValidationRecord) => {
      const path = editor.api.findPath(element);
      if (!path) return;
      const prev = (element.validation as ValidationRecord | undefined) ?? {};
      editor.tf.setNodes({ validation: { ...prev, ...patch } }, { at: path });
    },
    [editor, element],
  );
}

// ---------------------------------------------------------------------------
// RequiredToggle
// ---------------------------------------------------------------------------

export function RequiredToggle() {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const validation = element.validation as
    | { required?: boolean }
    | undefined;
  const required = validation?.required ?? false;
  const switchId = `required-toggle-${element.id}`;

  return (
    <div className="flex items-center gap-2">
      <Switch
        size="sm"
        id={switchId}
        checked={required}
        onCheckedChange={(checked) => update({ required: checked === true })}
      />
      <Label htmlFor={switchId} className="text-xs font-normal">
        必須
      </Label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChoiceOptionsEditor (radio / checkbox / dropdown)
// ---------------------------------------------------------------------------

interface OptionLike {
  id: string;
  label: string;
}

export function ChoiceOptionsEditor() {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const validation = element.validation as
    | { options?: OptionLike[] }
    | undefined;
  const options: OptionLike[] = validation?.options ?? [];

  const addOption = () => {
    const id = crypto.randomUUID();
    update({ options: [...options, { id, label: "" }] });
  };

  const removeOption = (targetId: string) => {
    update({ options: options.filter((o) => o.id !== targetId) });
  };

  const updateLabel = (targetId: string, label: string) => {
    update({
      options: options.map((o) => (o.id === targetId ? { ...o, label } : o)),
    });
  };

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground">選択肢</span>
      {options.map((option) => (
        <div key={option.id} className="flex items-center gap-2">
          <CompositionAwareInput
            value={option.label}
            onChange={(e) => updateLabel(option.id, e.target.value)}
            placeholder="選択肢を入力"
            className="h-8 text-sm"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => removeOption(option.id)}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={addOption}
      >
        <Plus className="mr-1 h-3 w-3" />
        選択肢を追加
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GridItemsEditor (choice_grid / checkbox_grid)
// ---------------------------------------------------------------------------

interface GridItemLike {
  id: string;
  label: string;
}

function GridList({
  label,
  items,
  onChange,
}: {
  label: string;
  items: GridItemLike[];
  onChange: (items: GridItemLike[]) => void;
}) {
  const add = () => {
    onChange([...items, { id: crypto.randomUUID(), label: "" }]);
  };
  const remove = (targetId: string) => {
    onChange(items.filter((i) => i.id !== targetId));
  };
  const updateLabel = (targetId: string, newLabel: string) => {
    onChange(
      items.map((i) => (i.id === targetId ? { ...i, label: newLabel } : i)),
    );
  };

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-2">
          <CompositionAwareInput
            value={item.label}
            onChange={(e) => updateLabel(item.id, e.target.value)}
            placeholder={`${label}を入力`}
            className="h-8 text-sm"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => remove(item.id)}
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={add}
      >
        <Plus className="mr-1 h-3 w-3" />
        {label}を追加
      </Button>
    </div>
  );
}

export function GridItemsEditor() {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const validation = element.validation as
    | { rows?: GridItemLike[]; columns?: GridItemLike[] }
    | undefined;
  const rows = validation?.rows ?? [];
  const columns = validation?.columns ?? [];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <GridList label="行" items={rows} onChange={(r) => update({ rows: r })} />
      <GridList
        label="列"
        items={columns}
        onChange={(c) => update({ columns: c })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// LinearScaleSettingsEditor
// ---------------------------------------------------------------------------

export function LinearScaleSettingsEditor() {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const validation = element.validation as
    | {
        min?: number;
        max?: number;
        step?: number;
        minLabel?: string;
        maxLabel?: string;
      }
    | undefined;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="space-y-1">
        <Label className="text-xs">最小値</Label>
        <Input
          type="number"
          value={validation?.min ?? 1}
          onChange={(e) => update({ min: Number(e.target.value) })}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">最大値</Label>
        <Input
          type="number"
          value={validation?.max ?? 5}
          onChange={(e) => update({ max: Number(e.target.value) })}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">ステップ</Label>
        <Input
          type="number"
          value={validation?.step ?? 1}
          onChange={(e) => update({ step: Number(e.target.value) })}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">最小ラベル</Label>
        <CompositionAwareInput
          value={validation?.minLabel ?? ""}
          onChange={(e) => update({ minLabel: e.target.value })}
          placeholder="例: 低い"
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">最大ラベル</Label>
        <CompositionAwareInput
          value={validation?.maxLabel ?? ""}
          onChange={(e) => update({ maxLabel: e.target.value })}
          placeholder="例: 高い"
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RatingSettingsEditor
// ---------------------------------------------------------------------------

export function RatingSettingsEditor() {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const validation = element.validation as
    | { maxRating?: number; icon?: "star" | "heart" | "thumbs" }
    | undefined;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs">最大評価</Label>
        <Input
          type="number"
          min={1}
          max={10}
          value={validation?.maxRating ?? 5}
          onChange={(e) => update({ maxRating: Number(e.target.value) })}
          className="h-8 w-20 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">アイコン</Label>
        <div className="flex gap-1">
          {(["star", "heart", "thumbs"] as const).map((icon) => (
            <Button
              key={icon}
              type="button"
              variant={
                (validation?.icon ?? "star") === icon ? "default" : "outline"
              }
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => update({ icon })}
            >
              {icon === "star" ? "\u2605" : icon === "heart" ? "\u2665" : "\uD83D\uDC4D"}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TextLengthEditor (short_text, long_text)
// ---------------------------------------------------------------------------

export function TextLengthEditor() {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const validation = element.validation as
    | { minLength?: number; maxLength?: number }
    | undefined;

  const minLength = validation?.minLength;
  const maxLength = validation?.maxLength;
  const hasConflict =
    minLength != null && maxLength != null && minLength > maxLength;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">最小文字数</Label>
          <Input
            type="number"
            min={0}
            step={1}
            value={validation?.minLength ?? ""}
            onChange={(e) =>
              update({
                minLength: e.target.value
                  ? parseInt(e.target.value, 10)
                  : undefined,
              })
            }
            placeholder="制限なし"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">最大文字数</Label>
          <Input
            type="number"
            min={0}
            step={1}
            value={validation?.maxLength ?? ""}
            onChange={(e) =>
              update({
                maxLength: e.target.value
                  ? parseInt(e.target.value, 10)
                  : undefined,
              })
            }
            placeholder="制限なし"
            className="h-8 text-sm"
          />
        </div>
      </div>
      {hasConflict && (
        <p className="text-xs text-destructive">
          最小文字数が最大文字数を超えています
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShortTextPatternEditor (short_text)
// ---------------------------------------------------------------------------

export function ShortTextPatternEditor() {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const { data: validationProvidersData } = useValidationProviders();
  const validationProviders = validationProvidersData?.data ?? [];
  const patternTemplates = getValidationPatternTemplates(validationProviders);
  const validation = element.validation as
    | {
        patternTemplate?: string;
        pattern?: string;
        allowPatternMismatch?: boolean;
        placeholder?: string;
      }
    | undefined;

  const [patternError, setPatternError] = useState<string | undefined>();
  const NONE_SENTINEL = "__none__";
  const templateId = validation?.patternTemplate || NONE_SENTINEL;
  const isCustom = templateId === CUSTOM_TEMPLATE_ID;
  const mismatchId = `allow-pattern-mismatch-${element.id}`;

  useEffect(() => {
    if (!isCustom || !validation?.pattern) {
      setPatternError(undefined);
      return;
    }
    try {
      new RegExp(validation.pattern);
      setPatternError(undefined);
    } catch {
      setPatternError("正規表現の構文が正しくありません");
    }
  }, [isCustom, validation?.pattern]);

  const handleTemplateChange = (rawId: string) => {
    const newTemplateId = rawId === NONE_SENTINEL ? "" : rawId;
    if (!newTemplateId) {
      update({
        patternTemplate: undefined,
        pattern: undefined,
        allowPatternMismatch: undefined,
        placeholder: undefined,
        minLength: undefined,
        maxLength: undefined,
      });
      return;
    }
    const template = getValidationPatternTemplate(
      newTemplateId,
      validationProviders,
    );
    update({
      patternTemplate: newTemplateId,
      pattern: template?.pattern ?? "",
      placeholder: template?.placeholder ?? "",
      minLength: template?.minLength,
      maxLength: template?.maxLength,
      allowPatternMismatch: undefined,
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">入力パターン</Label>
        <Select value={templateId} onValueChange={handleTemplateChange}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="パターンなし" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_SENTINEL}>パターンなし</SelectItem>
            {patternTemplates.map((tmpl) => (
              <SelectItem key={tmpl.id} value={tmpl.id}>
                {tmpl.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isCustom && (
        <div className="space-y-1">
          <Label className="text-xs">正規表現パターン</Label>
          <CompositionAwareInput
            value={validation?.pattern ?? ""}
            onChange={(e) => update({ pattern: e.target.value })}
            placeholder="^[a-zA-Z]+$"
            className="h-8 text-sm font-mono"
          />
          {patternError && (
            <p className="text-xs text-destructive">{patternError}</p>
          )}
        </div>
      )}

      {templateId !== NONE_SENTINEL && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">プレースホルダー</Label>
            <CompositionAwareInput
              value={validation?.placeholder ?? ""}
              onChange={(e) => update({ placeholder: e.target.value })}
              placeholder="入力例"
              className="h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              size="sm"
              id={mismatchId}
              checked={validation?.allowPatternMismatch ?? false}
              onCheckedChange={(checked) =>
                update({ allowPatternMismatch: checked === true })
              }
            />
            <Label
              htmlFor={mismatchId}
              className="text-xs font-normal"
            >
              パターン不一致を許可（警告のみ）
            </Label>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AllowOtherEditor (radio, checkbox, dropdown)
// ---------------------------------------------------------------------------

export function AllowOtherEditor() {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const validation = element.validation as
    | { allowOther?: boolean; otherLabel?: string }
    | undefined;

  const allowOther = validation?.allowOther ?? false;
  const switchId = `allow-other-${element.id}`;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Switch
          size="sm"
          id={switchId}
          checked={allowOther}
          onCheckedChange={(checked) => {
            if (checked) {
              update({ allowOther: true });
            } else {
              update({ allowOther: false, otherLabel: undefined });
            }
          }}
        />
        <Label htmlFor={switchId} className="text-xs font-normal">
          「その他」を許可
        </Label>
      </div>
      {allowOther && (
        <div className="space-y-1">
          <Label className="text-xs">その他のラベル</Label>
          <CompositionAwareInput
            value={validation?.otherLabel ?? ""}
            onChange={(e) => update({ otherLabel: e.target.value })}
            placeholder="その他"
            className="h-8 text-sm"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectionLimitsEditor (checkbox)
// ---------------------------------------------------------------------------

export function SelectionLimitsEditor() {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const validation = element.validation as
    | { minSelections?: number; maxSelections?: number }
    | undefined;

  const minSelections = validation?.minSelections;
  const maxSelections = validation?.maxSelections;
  const hasConflict =
    minSelections != null && maxSelections != null && minSelections > maxSelections;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">最小選択数</Label>
          <Input
            type="number"
            min={0}
            step={1}
            value={validation?.minSelections ?? ""}
            onChange={(e) =>
              update({
                minSelections: e.target.value
                  ? parseInt(e.target.value, 10)
                  : undefined,
              })
            }
            placeholder="制限なし"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">最大選択数</Label>
          <Input
            type="number"
            min={0}
            step={1}
            value={validation?.maxSelections ?? ""}
            onChange={(e) =>
              update({
                maxSelections: e.target.value
                  ? parseInt(e.target.value, 10)
                  : undefined,
              })
            }
            placeholder="制限なし"
            className="h-8 text-sm"
          />
        </div>
      </div>
      {hasConflict && (
        <p className="text-xs text-destructive">
          最小選択数が最大選択数を超えています
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GridSelectionLimitsEditor (checkbox_grid)
// ---------------------------------------------------------------------------

export function GridSelectionLimitsEditor() {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const validation = element.validation as
    | { minSelectionsPerRow?: number; maxSelectionsPerRow?: number }
    | undefined;

  const minPerRow = validation?.minSelectionsPerRow;
  const maxPerRow = validation?.maxSelectionsPerRow;
  const hasConflict =
    minPerRow != null && maxPerRow != null && minPerRow > maxPerRow;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">行あたり最小選択数</Label>
          <Input
            type="number"
            min={0}
            step={1}
            value={validation?.minSelectionsPerRow ?? ""}
            onChange={(e) =>
              update({
                minSelectionsPerRow: e.target.value
                  ? parseInt(e.target.value, 10)
                  : undefined,
              })
            }
            placeholder="制限なし"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">行あたり最大選択数</Label>
          <Input
            type="number"
            min={0}
            step={1}
            value={validation?.maxSelectionsPerRow ?? ""}
            onChange={(e) =>
              update({
                maxSelectionsPerRow: e.target.value
                  ? parseInt(e.target.value, 10)
                  : undefined,
              })
            }
            placeholder="制限なし"
            className="h-8 text-sm"
          />
        </div>
      </div>
      {hasConflict && (
        <p className="text-xs text-destructive">
          行あたり最小選択数が最大選択数を超えています
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DateSettingsEditor (date)
// ---------------------------------------------------------------------------

export function DateSettingsEditor() {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const validation = element.validation as
    | { minDate?: string; maxDate?: string }
    | undefined;

  const minDate = validation?.minDate;
  const maxDate = validation?.maxDate;
  const hasConflict = !!minDate && !!maxDate && minDate > maxDate;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">最小日付</Label>
          <Input
            type="date"
            value={validation?.minDate ?? ""}
            onChange={(e) =>
              update({ minDate: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">最大日付</Label>
          <Input
            type="date"
            value={validation?.maxDate ?? ""}
            onChange={(e) =>
              update({ maxDate: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
      </div>
      {hasConflict && (
        <p className="text-xs text-destructive">
          最小日付が最大日付を超えています
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TimeSettingsEditor (time)
// ---------------------------------------------------------------------------

export function TimeSettingsEditor() {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const validation = element.validation as
    | { minTime?: string; maxTime?: string }
    | undefined;

  const minTime = validation?.minTime;
  const maxTime = validation?.maxTime;
  const hasConflict = !!minTime && !!maxTime && minTime > maxTime;

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">最小時刻</Label>
          <Input
            type="time"
            value={validation?.minTime ?? ""}
            onChange={(e) =>
              update({ minTime: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">最大時刻</Label>
          <Input
            type="time"
            value={validation?.maxTime ?? ""}
            onChange={(e) =>
              update({ maxTime: e.target.value || undefined })
            }
            className="h-8 text-sm"
          />
        </div>
      </div>
      {hasConflict && (
        <p className="text-xs text-destructive">
          最小時刻が最大時刻を超えています
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EditorControlsWrapper — combines required toggle + type-specific controls
// ---------------------------------------------------------------------------

export function EditorControlsWrapper({
  children,
}: { children?: ReactNode }) {
  return (
    <div className="space-y-3">
      <RequiredToggle />
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionTransitionEditor — default action + conditional rules for section
// ---------------------------------------------------------------------------

/** Minimal block shape consumed by LogicConditionBuilder / LogicActionBuilder. */
interface EditorBlock {
  blockId: string;
  title: string;
  type: string;
}

/**
 * Extract question-like blocks that appear BEFORE this separator in the
 * editor tree. Only preceding questions make sense as condition targets
 * because later sections have not been answered yet at transition time.
 */
function useEditorBlocks(): EditorBlock[] {
  const editor = useEditorRef();
  const element = useElement<TElement>();
  return useMemo(() => {
    const blocks: EditorBlock[] = [];
    for (const child of editor.children as TElement[]) {
      // Stop collecting once we reach the current separator
      if (child.blockId === element.blockId) break;
      const type = child.type as string;
      if (
        type.startsWith("form_") &&
        type !== "form_section_separator"
      ) {
        const blockId =
          typeof child.blockId === "string" ? child.blockId : "";
        const strippedType = type.replace(/^form_/, "");
        const rawTitle = Array.isArray(child.children)
          ? extractTitleFromChildren(child.children as unknown[])
          : "";
        const displayName = getBlockTypeDisplayName(strippedType as BlockType);
        const title =
          rawTitle ||
          (blockId
            ? `無題の${displayName}(${blockId})`
            : `無題の${displayName}`);
        blocks.push({ blockId, title, type: strippedType });
      }
    }
    return blocks;
  }, [editor.children, element.blockId]);
}

const DEFAULT_ACTION_LABELS: Record<SectionTransitionAction["type"], string> = {
  next: "次のセクションに進む",
  jump_to_section: "セクションに移動",
  submit: "フォームを送信",
};

export function SectionTransitionEditor({
  sectionCtx,
}: { sectionCtx: PlateSectionContext }) {
  const element = useElement<TElement>();
  const update = useUpdateValidation();
  const editorBlocks = useEditorBlocks();
  const [rulesOpen, setRulesOpen] = useState(false);

  const validation = element.validation as
    | {
        default_action?: SectionTransitionAction;
        navigation_rules?: FormLogicRule[];
      }
    | undefined;

  const defaultAction: SectionTransitionAction = useMemo(
    () => validation?.default_action ?? { type: "next" },
    [validation?.default_action],
  );
  const navigationRules: FormLogicRule[] = useMemo(
    () => validation?.navigation_rules ?? [],
    [validation?.navigation_rules],
  );

  // Available sections for "jump to" (exclude preceding and current sections)
  const availableSections = useMemo(
    () =>
      sectionCtx.sections
        .filter(
          (s) =>
            s.index !== sectionCtx.precedingSectionIndex &&
            s.index !== sectionCtx.sectionIndex,
        )
        .map((s) => ({ id: s.id, title: `${s.title}` })),
    [sectionCtx.sections, sectionCtx.precedingSectionIndex, sectionCtx.sectionIndex],
  );

  // If the jump target was deleted or is missing, fall back to "next"
  const resolvedDefaultAction: SectionTransitionAction = useMemo(() => {
    if (
      defaultAction.type === "jump_to_section" &&
      (!defaultAction.target_id ||
        !availableSections.some((s) => s.id === defaultAction.target_id))
    ) {
      return { type: "next" };
    }
    return defaultAction;
  }, [defaultAction, availableSections]);

  // Default action handlers
  const handleDefaultActionTypeChange = (
    type: SectionTransitionAction["type"],
  ) => {
    if (type === "jump_to_section") {
      const firstTarget = availableSections[0]?.id;
      if (!firstTarget) return; // No valid targets – do not switch
      update({ default_action: { type, target_id: firstTarget } });
    } else {
      update({ default_action: { type } });
    }
  };

  const handleDefaultActionTargetChange = (targetId: string) => {
    update({
      default_action: { ...defaultAction, target_id: targetId },
    });
  };

  // Conditional rule handlers
  const handleAddRule = () => {
    const nextNameIndex =
      navigationRules.length > 0
        ? Math.max(
            ...navigationRules.map((r) => {
              const m = r.name.match(/(\d+)$/);
              return m ? Number(m[1]) : 0;
            }),
          ) + 1
        : 1;
    const newRule: FormLogicRule = {
      id: crypto.randomUUID(),
      name: `ルール ${nextNameIndex}`,
      conditions:
        editorBlocks.length > 0 && editorBlocks[0]
          ? [
              {
                question_id: editorBlocks[0].blockId,
                operator: "equals" as const,
                value: "",
              },
            ]
          : [],
      condition_match: "all",
      action: { type: "next" },
      enabled: true,
      priority:
        navigationRules.length > 0
          ? Math.max(...navigationRules.map((r) => r.priority)) + 1
          : 0,
      stop_on_match: false,
    };
    update({ navigation_rules: [...navigationRules, newRule] });
  };

  const handleUpdateRule = (index: number, updatedRule: FormLogicRule) => {
    const updated = [...navigationRules];
    updated[index] = updatedRule;
    update({ navigation_rules: updated });
  };

  const handleDeleteRule = (index: number) => {
    update({ navigation_rules: navigationRules.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">
      {/* Default action */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">
          セクション {sectionCtx.precedingSectionIndex} 以降
        </Label>
        <div className="flex gap-2">
          <Select
            value={resolvedDefaultAction.type}
            onValueChange={(v) =>
              handleDefaultActionTypeChange(
                v as SectionTransitionAction["type"],
              )
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DEFAULT_ACTION_LABELS).map(([key, label]) => (
                <SelectItem
                  key={key}
                  value={key}
                  disabled={
                    key === "jump_to_section" &&
                    availableSections.length === 0
                  }
                >
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {resolvedDefaultAction.type === "jump_to_section" && (
            <Select
              value={resolvedDefaultAction.target_id ?? ""}
              onValueChange={handleDefaultActionTargetChange}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="セクションを選択" />
              </SelectTrigger>
              <SelectContent>
                {availableSections.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Conditional rules (collapsible) */}
      <div>
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setRulesOpen(!rulesOpen)}
        >
          {rulesOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          条件付きルール
          {navigationRules.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              {navigationRules.length}
            </span>
          )}
        </button>

        {rulesOpen && (
          <div className="mt-2 space-y-3 rounded-md border border-dashed p-3">
            {navigationRules.map((rule, index) => (
              <NavigationRuleItem
                key={rule.id}
                rule={rule}
                availableBlocks={editorBlocks}
                availableSections={availableSections}
                onChange={(updated) => handleUpdateRule(index, updated)}
                onDelete={() => handleDeleteRule(index)}
              />
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={handleAddRule}
            >
              <Plus className="mr-1 h-3 w-3" />
              ルールを追加
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NavigationRuleItem — single conditional rule within the section transition
// ---------------------------------------------------------------------------

interface NavigationRuleItemProps {
  rule: FormLogicRule;
  availableBlocks: Array<{ blockId: string; title: string }>;
  availableSections: Array<{ id: string; title: string }>;
  onChange: (rule: FormLogicRule) => void;
  onDelete: () => void;
}

function NavigationRuleItem({
  rule,
  availableBlocks,
  availableSections,
  onChange,
  onDelete,
}: NavigationRuleItemProps) {
  const handleConditionsChange = (conditions: FormLogicCondition[]) => {
    onChange({ ...rule, conditions });
  };

  const handleConditionMatchChange = (conditionMatch: "all" | "any") => {
    onChange({ ...rule, condition_match: conditionMatch });
  };

  const handleActionChange = (action: FormLogicAction) => {
    onChange({ ...rule, action });
  };

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">
          {rule.name}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
      </div>

      <LogicConditionBuilder
        conditions={rule.conditions}
        availableBlocks={availableBlocks}
        onChange={handleConditionsChange}
        conditionMatch={rule.condition_match}
        onConditionMatchChange={handleConditionMatchChange}
      />

      <LogicActionBuilder
        action={rule.action}
        availableBlocks={availableBlocks}
        availableSections={availableSections}
        onChange={handleActionChange}
      />
    </div>
  );
}
