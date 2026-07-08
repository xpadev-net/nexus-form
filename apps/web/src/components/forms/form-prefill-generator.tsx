import {
  type ExtractedQuestion,
  extractQuestionsFromPlateContent,
  splitPlateContentIntoPages,
} from "@nexus-form/shared";
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  Copy,
  Eraser,
  ExternalLink,
  Link2,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AnswerEntry } from "@/contexts/form-response-context";
import {
  type CopyFeedbackStatus,
  useCopyFeedback,
} from "@/hooks/use-copy-feedback";
import {
  encodePrefillData,
  filterPrefillDataForReachableQuestionIds,
  getPrefilledQuestions,
  getPrefillQuestionTypeInfo,
  getPrefillQuestionTypeLabel,
  getReachableQuestionIdsFromPrefillValues,
  isEntryEmpty,
  isPrefillSupportedQuestionType,
  PREFILL_SUPPORTED_QUESTION_TYPES,
  PREFILL_UNSUPPORTED_QUESTION_TYPES,
  type PrefillData,
} from "@/lib/forms/prefill";
import { buildPublicFormUrl } from "@/lib/forms/public-url";

interface FormPrefillGeneratorProps {
  plateContent: string;
  publicId: string;
}

interface OptionLike {
  id: string;
  label: string;
}

const MAX_SAFE_URL_LENGTH = 1900;

function buildPrefillUrl(publicId: string, data: PrefillData): string {
  const encoded = encodePrefillData(data);
  return `${buildPublicFormUrl(publicId)}?p=${encoded}`;
}

interface PrefillCopyButtonProps
  extends Omit<
    ComponentProps<typeof Button>,
    "children" | "onClick" | "onCopy"
  > {
  copyText: string;
  iconClassName?: string;
  idleLabel: string;
  onCopy: (copyText: string) => Promise<CopyResult>;
}

type CopyResult = "copied" | "failed" | "stale";

const prefillCopyFeedback = {
  copied: {
    className: "bg-emerald-600 hover:bg-emerald-600",
    icon: CheckCircle2,
    label: "コピー済み",
  },
  failed: {
    className: "border-destructive/60 text-destructive",
    icon: TriangleAlert,
    label: "コピー失敗",
  },
  idle: {
    className: undefined,
    icon: Copy,
    label: undefined,
  },
} satisfies Record<
  CopyFeedbackStatus,
  {
    className?: string;
    icon: typeof Copy;
    label?: string;
  }
>;

function PrefillCopyButton({
  className,
  copyText,
  disabled,
  iconClassName = "mr-1 h-3.5 w-3.5",
  idleLabel,
  onCopy,
  ...props
}: PrefillCopyButtonProps) {
  const { markCopied, markFailed, status } = useCopyFeedback();
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleClick = async () => {
    const result = await onCopy(copyText);
    if (!isMountedRef.current || result === "stale") {
      return;
    }
    if (result === "copied") {
      markCopied();
      return;
    }
    markFailed();
  };

  const feedback = prefillCopyFeedback[status];
  const Icon = feedback.icon;
  const label = feedback.label ?? idleLabel;
  const classes = [className, feedback.className].filter(Boolean).join(" ");

  return (
    <Button
      {...props}
      className={classes || undefined}
      disabled={disabled}
      onClick={() => void handleClick()}
      data-copy-status={status}
      title={label}
    >
      <Icon className={iconClassName} />
      {label}
    </Button>
  );
}

export function FormPrefillGenerator({
  plateContent,
  publicId,
}: FormPrefillGeneratorProps) {
  const [prefillValues, setPrefillValues] = useState<PrefillData>({});

  const parsedPlateContent = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(plateContent);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch {
      return [];
    }
  }, [plateContent]);

  const questions = useMemo(() => {
    return extractQuestionsFromPlateContent(parsedPlateContent).filter(
      (q) => q.type !== "section_separator",
    );
  }, [parsedPlateContent]);

  const pages = useMemo(() => {
    if (parsedPlateContent.length === 0) return [];
    return splitPlateContentIntoPages(parsedPlateContent);
  }, [parsedPlateContent]);

  const reachableQuestionIds = useMemo(() => {
    return new Set(
      getReachableQuestionIdsFromPrefillValues(pages, prefillValues),
    );
  }, [pages, prefillValues]);

  const supportedReachablePrefillValues = useMemo(
    () =>
      filterPrefillDataForReachableQuestionIds(
        questions,
        reachableQuestionIds,
        prefillValues,
      ),
    [questions, prefillValues, reachableQuestionIds],
  );
  const prefilledQuestions = useMemo(
    () => getPrefilledQuestions(questions, supportedReachablePrefillValues),
    [questions, supportedReachablePrefillValues],
  );
  const unsupportedQuestions = useMemo(
    () =>
      questions.filter(
        (question) => !isPrefillSupportedQuestionType(question.type),
      ),
    [questions],
  );
  const unreachableQuestions = useMemo(
    () =>
      questions.filter((question) => {
        if (!isPrefillSupportedQuestionType(question.type)) {
          return false;
        }
        const entry = prefillValues[question.blockId];
        if (entry === undefined || isEntryEmpty(entry)) {
          return false;
        }
        return !reachableQuestionIds.has(question.blockId);
      }),
    [questions, prefillValues, reachableQuestionIds],
  );
  const emptyQuestions = useMemo(
    () =>
      questions.filter((question) => {
        if (!isPrefillSupportedQuestionType(question.type)) {
          return false;
        }
        if (reachableQuestionIds.has(question.blockId) === false) {
          return false;
        }
        const entry = prefillValues[question.blockId];
        return entry === undefined || isEntryEmpty(entry);
      }),
    [questions, prefillValues, reachableQuestionIds],
  );

  const setValue = useCallback((blockId: string, entry: AnswerEntry) => {
    setPrefillValues((prev) => {
      if (isEntryEmpty(entry)) {
        const next = { ...prev };
        delete next[blockId];
        return next;
      }
      return { ...prev, [blockId]: entry };
    });
  }, []);

  const clearAll = useCallback(() => {
    setPrefillValues({});
  }, []);

  const hasPrefillValues =
    Object.keys(supportedReachablePrefillValues).length > 0;

  const generatedUrl = useMemo(() => {
    if (Object.keys(supportedReachablePrefillValues).length === 0) return "";
    return buildPrefillUrl(publicId, supportedReachablePrefillValues);
  }, [supportedReachablePrefillValues, publicId]);
  const generatedUrlRef = useRef(generatedUrl);
  generatedUrlRef.current = generatedUrl;

  const isUrlTooLong = generatedUrl.length > MAX_SAFE_URL_LENGTH;

  const copyGeneratedUrl = useCallback(
    async (urlToCopy: string): Promise<CopyResult> => {
      if (!urlToCopy) return "failed";
      try {
        await navigator.clipboard.writeText(urlToCopy);
        if (generatedUrlRef.current !== urlToCopy) {
          return "stale";
        }
        toast.success("プリフィルURLをコピーしました");
        if (urlToCopy.length > MAX_SAFE_URL_LENGTH) {
          toast.warning("URLが長いため一部の環境で開けない可能性があります");
        }
        return "copied";
      } catch {
        if (generatedUrlRef.current !== urlToCopy) {
          return "stale";
        }
        return "failed";
      }
    },
    [],
  );

  const handleGeneratedUrlCopy = useCallback(
    async (urlToCopy: string) => {
      const result = await copyGeneratedUrl(urlToCopy);
      if (result === "failed") {
        toast.error("URLをコピーできませんでした");
      }
      return result;
    },
    [copyGeneratedUrl],
  );

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
          <PrefillCopyButton
            key={`header:${generatedUrl}`}
            copyText={generatedUrl}
            onCopy={handleGeneratedUrlCopy}
            size="sm"
            disabled={!hasPrefillValues}
            idleLabel="URLをコピー"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        各質問にデフォルト値を入力すると、あらかじめ回答が埋められたURLを生成できます。
      </p>

      <PrefillSupportLegend />

      {generatedUrl && (
        <div className="space-y-2" data-testid="prefill-url-preview">
          <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2 transition-colors">
            <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              className="min-w-0 flex-1 basis-48 bg-transparent text-xs"
              readOnly
              value={generatedUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <PrefillCopyButton
              key={`preview:${generatedUrl}`}
              copyText={generatedUrl}
              onCopy={handleGeneratedUrlCopy}
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
              idleLabel="コピー"
              iconClassName="mr-1 h-3 w-3"
            />
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-xs"
            >
              <a href={generatedUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="mr-1 h-3 w-3" />
                別タブで確認
              </a>
            </Button>
          </div>
          {isUrlTooLong && (
            <p className="flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              URLが長いため、一部の環境で正しく開けない可能性があります
            </p>
          )}
          <div
            className="grid gap-3 rounded-md border border-dashed bg-muted/20 p-2 text-xs sm:grid-cols-2"
            data-testid="prefill-preview-filled-questions"
          >
            <div>
              <p className="font-medium text-foreground">反映される設問</p>
              {prefilledQuestions.length > 0 ? (
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {prefilledQuestions.map((question) => (
                    <li key={question.blockId}>
                      {question.title || "無題の質問"} (
                      {getPrefillQuestionTypeLabel(question.type)})
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  現在、反映される設問はありません。
                </p>
              )}
            </div>
            <div>
              <p className="font-medium text-foreground">
                到達不能で除外される設問
              </p>
              {unreachableQuestions.length > 0 ? (
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {unreachableQuestions.map((question) => (
                    <li key={question.blockId}>
                      {question.title || "無題の質問"} (
                      {getPrefillQuestionTypeLabel(question.type)})
                      <span className="block">
                        分岐条件で到達できないため除外されます。
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">なし</p>
              )}
            </div>
            <div>
              <p className="font-medium text-foreground">未入力設問</p>
              {emptyQuestions.length > 0 ? (
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {emptyQuestions.map((question) => {
                    const typeInfo = getPrefillQuestionTypeInfo(question.type);
                    return (
                      <li key={question.blockId}>
                        {question.title || "無題の質問"} ({typeInfo.label})
                        <span className="block">
                          初期値が入力されていません。
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">なし</p>
              )}
            </div>
            <div>
              <p className="font-medium text-foreground">未対応設問</p>
              {unsupportedQuestions.length > 0 ? (
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {unsupportedQuestions.map((question) => {
                    const typeInfo = getPrefillQuestionTypeInfo(question.type);
                    return (
                      <li key={question.blockId}>
                        {question.title || "無題の質問"} ({typeInfo.label})
                        <span className="block">
                          未対応のためURLに含まれません。
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">なし</p>
              )}
            </div>
          </div>
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

function PrefillSupportLegend() {
  return (
    <div
      className="space-y-2 rounded-md border bg-muted/20 p-3 text-xs"
      data-testid="prefill-support-legend"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">対応</Badge>
        <span className="text-muted-foreground">
          {PREFILL_SUPPORTED_QUESTION_TYPES.map(
            getPrefillQuestionTypeLabel,
          ).join("、")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">未対応</Badge>
        {PREFILL_UNSUPPORTED_QUESTION_TYPES.map((type) => {
          const typeInfo = getPrefillQuestionTypeInfo(type);
          const guidance = formatUnsupportedGuidance(typeInfo);
          return (
            <UnsupportedTypeTooltip key={type} typeInfo={typeInfo}>
              <button
                type="button"
                className="inline-flex appearance-none rounded-full border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                title={guidance}
              >
                <Badge variant="outline">{typeInfo.label}</Badge>
              </button>
            </UnsupportedTypeTooltip>
          );
        })}
      </div>
    </div>
  );
}

interface UnsupportedTypeTooltipProps {
  children: ReactNode;
  typeInfo: ReturnType<typeof getPrefillQuestionTypeInfo>;
}

function UnsupportedTypeTooltip({
  children,
  typeInfo,
}: UnsupportedTypeTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-72 space-y-1">
        <p>{typeInfo.reason}</p>
        <p>代替案: {typeInfo.alternative}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function formatUnsupportedGuidance(
  typeInfo: ReturnType<typeof getPrefillQuestionTypeInfo>,
): string {
  return `${typeInfo.reason ?? ""} 代替案: ${
    typeInfo.alternative ?? "通常の設問へ分割してください。"
  }`;
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
  const typeInfo = useMemo(
    () => getPrefillQuestionTypeInfo(question.type),
    [question.type],
  );
  const unsupportedGuidance = useMemo(
    () => formatUnsupportedGuidance(typeInfo),
    [typeInfo],
  );

  const setText = useCallback(
    (v: string) => onChange({ value: v || undefined }),
    [onChange],
  );

  const setNumber = useCallback(
    (v: string) => onChange({ value: v ? Number(v) : undefined }),
    [onChange],
  );

  const copyUnsupportedGuidance = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(unsupportedGuidance);
      toast.success("代替案をコピーしました");
    } catch {
      toast.error("代替案をコピーできませんでした");
    }
  }, [unsupportedGuidance]);

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
          <div className="flex items-start gap-2 rounded-md bg-muted/30 p-2 text-xs text-muted-foreground">
            <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="space-y-1">
              <p>この設問は生成URLに含まれません。</p>
              <UnsupportedTypeTooltip typeInfo={typeInfo}>
                <button
                  type="button"
                  className="text-left underline underline-offset-2"
                  title={unsupportedGuidance}
                >
                  理由と代替案を確認
                </button>
              </UnsupportedTypeTooltip>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="mt-1"
                onClick={copyUnsupportedGuidance}
              >
                <Copy className="mr-1 h-3 w-3" />
                代替案をコピー
              </Button>
            </div>
          </div>
        );
    }
  }, [
    question,
    value,
    onChange,
    setText,
    setNumber,
    typeInfo,
    unsupportedGuidance,
    copyUnsupportedGuidance,
  ]);

  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <Label className="text-sm font-medium leading-relaxed">
          {question.title || "無題の質問"}
        </Label>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {typeInfo.label}
          </span>
          <Badge variant={typeInfo.supported ? "secondary" : "outline"}>
            {typeInfo.supported ? "対応" : "未対応"}
          </Badge>
        </div>
      </div>
      {field}
    </div>
  );
}
