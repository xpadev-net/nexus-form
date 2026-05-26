import {
  type ExtractedQuestion,
  extractQuestionsFromPlateContent,
} from "@nexus-form/shared";
import { AlertTriangle, Copy, Eraser, Link2, Wand2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AnswerEntry } from "@/contexts/form-response-context";
import { encodePrefillData, type PrefillData } from "@/lib/forms/prefill";

interface FormPrefillGeneratorProps {
  plateContent: string;
  publicId: string;
}

const QUESTION_TYPE_LABELS: Record<string, string> = {
  short_text: "短文",
  long_text: "長文",
  radio: "ラジオ",
  checkbox: "チェックボックス",
  dropdown: "プルダウン",
  linear_scale: "均等目盛",
  rating: "評価",
  date: "日付",
  time: "時刻",
};

interface OptionLike {
  id: string;
  label: string;
}

const MAX_SAFE_URL_LENGTH = 1900;

function buildPrefillUrl(
  baseUrl: string,
  publicId: string,
  data: PrefillData,
): string {
  const encoded = encodePrefillData(data);
  return `${baseUrl}/forms/public/${publicId}?p=${encoded}`;
}

function getOrigin(): string {
  return window.location.origin;
}

export function FormPrefillGenerator({
  plateContent,
  publicId,
}: FormPrefillGeneratorProps) {
  const [prefillValues, setPrefillValues] = useState<PrefillData>({});

  const questions = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(plateContent);
      if (!Array.isArray(parsed)) return [];
      return extractQuestionsFromPlateContent(parsed).filter(
        (q) => q.type !== "section_separator",
      );
    } catch {
      return [];
    }
  }, [plateContent]);

  const setValue = useCallback((blockId: string, entry: AnswerEntry) => {
    setPrefillValues((prev) => ({ ...prev, [blockId]: entry }));
  }, []);

  const clearAll = useCallback(() => {
    setPrefillValues({});
  }, []);

  const generatedUrl = useMemo(() => {
    const hasValues = Object.keys(prefillValues).length > 0;
    if (!hasValues) return "";
    return buildPrefillUrl(getOrigin(), publicId, prefillValues);
  }, [prefillValues, publicId]);

  const isUrlTooLong = generatedUrl.length > MAX_SAFE_URL_LENGTH;

  const handleCopyUrl = useCallback(async () => {
    if (!generatedUrl) return;
    try {
      await navigator.clipboard.writeText(generatedUrl);
      toast.success("プリフィルURLをコピーしました");
      if (isUrlTooLong) {
        toast.warning("URLが長いため一部の環境で開けない可能性があります");
      }
    } catch {
      toast.error("URLをコピーできませんでした");
    }
  }, [generatedUrl, isUrlTooLong]);

  if (questions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        フォームに質問がありません。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Wand2 className="h-4 w-4" />
          プリフィルURL生成
        </h3>
        <div className="flex items-center gap-2">
          {Object.keys(prefillValues).length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <Eraser className="mr-1 h-3.5 w-3.5" />
              クリア
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleCopyUrl}
            disabled={Object.keys(prefillValues).length === 0}
          >
            <Copy className="mr-1 h-3.5 w-3.5" />
            URLをコピー
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        各質問にデフォルト値を入力すると、あらかじめ回答が埋められたURLを生成できます。
      </p>

      {generatedUrl && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
            <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              className="min-w-0 flex-1 bg-transparent text-xs"
              readOnly
              value={generatedUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
              onClick={handleCopyUrl}
            >
              <Copy className="mr-1 h-3 w-3" />
              コピー
            </Button>
          </div>
          {isUrlTooLong && (
            <p className="flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              URLが長いため、一部の環境で正しく開けない可能性があります
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        {questions.map((q) => (
          <QuestionPrefillField
            key={q.blockId}
            question={q}
            value={prefillValues[q.blockId]}
            onChange={(entry) => setValue(q.blockId, entry)}
          />
        ))}
      </div>
    </div>
  );
}

interface QuestionPrefillFieldProps {
  question: ExtractedQuestion;
  value?: AnswerEntry;
  onChange: (entry: AnswerEntry) => void;
}

function QuestionPrefillField({
  question,
  value,
  onChange,
}: QuestionPrefillFieldProps) {
  const typeLabel = QUESTION_TYPE_LABELS[question.type] ?? question.type;

  const setText = useCallback(
    (v: string) => onChange({ value: v || undefined }),
    [onChange],
  );

  const setNumber = useCallback(
    (v: string) => onChange({ value: v || undefined }),
    [onChange],
  );

  const field = useMemo(() => {
    switch (question.type) {
      case "short_text":
      case "long_text":
        return (
          <Input
            placeholder="値を入力"
            value={(value?.value as string) ?? ""}
            onChange={(e) => setText(e.target.value)}
          />
        );

      case "radio":
      case "dropdown": {
        const options = (
          question.validation as { options?: OptionLike[] } | undefined
        )?.options;
        return (
          <Select
            value={(value?.value as string) ?? ""}
            onValueChange={(v: string) => onChange({ value: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="選択してください" />
            </SelectTrigger>
            <SelectContent>
              {(options ?? []).map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case "checkbox": {
        const options = (
          question.validation as { options?: OptionLike[] } | undefined
        )?.options;
        const selected = (value?.values as string[]) ?? [];
        const toggleOption = (optionId: string, checked: boolean) => {
          const next = checked
            ? [...selected, optionId]
            : selected.filter((id) => id !== optionId);
          onChange({ values: next.length > 0 ? next : undefined });
        };
        return (
          <div className="space-y-1">
            {(!options || options.length === 0) && (
              <p className="text-xs text-muted-foreground">
                選択肢がありません
              </p>
            )}
            {(options ?? []).map((opt) => (
              <div key={opt.id} className="flex items-center gap-2">
                <Checkbox
                  id={`prefill-${question.blockId}-${opt.id}`}
                  checked={selected.includes(opt.id)}
                  onCheckedChange={(checked) =>
                    toggleOption(opt.id, checked === true)
                  }
                />
                <Label
                  htmlFor={`prefill-${question.blockId}-${opt.id}`}
                  className="text-sm font-normal"
                >
                  {opt.label}
                </Label>
              </div>
            ))}
          </div>
        );
      }

      case "linear_scale":
      case "rating":
        return (
          <Input
            type="number"
            placeholder="数値を入力"
            value={(value?.value as string) ?? ""}
            onChange={(e) => setNumber(e.target.value)}
          />
        );

      case "date":
        return (
          <Input
            type="date"
            value={(value?.value as string) ?? ""}
            onChange={(e) => setText(e.target.value)}
          />
        );

      case "time":
        return (
          <Input
            type="time"
            value={(value?.value as string) ?? ""}
            onChange={(e) => setText(e.target.value)}
          />
        );

      default:
        return (
          <p className="text-xs text-muted-foreground">
            この質問タイプはプリフィル未対応です
          </p>
        );
    }
  }, [question, value, onChange, setText, setNumber]);

  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <Label className="text-sm font-medium leading-relaxed">
          {question.title || "無題の質問"}
        </Label>
        <span className="shrink-0 text-xs text-muted-foreground">
          {typeLabel}
        </span>
      </div>
      {field}
    </div>
  );
}
