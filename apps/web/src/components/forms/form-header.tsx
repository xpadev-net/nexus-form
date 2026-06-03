import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface FormHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  onTitleBlur?: (newTitle: string) => void;
  onTitleDraftChange?: (newTitle: string) => void;
  isTitleSaving?: boolean;
  titleSaveFailureCount?: number;
}

export function FormHeader({
  title,
  description,
  action,
  onTitleBlur,
  onTitleDraftChange,
  isTitleSaving,
  titleSaveFailureCount,
}: FormHeaderProps) {
  const [localTitle, setLocalTitle] = useState(title);
  const [isFocused, setIsFocused] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const isFocusedRef = useRef(false);
  // ref で最新値を保持することで useCallback/useEffect の deps から除外し、不要な再生成を防ぐ
  const titleRef = useRef(title);
  titleRef.current = title;
  const localTitleRef = useRef(localTitle);
  localTitleRef.current = localTitle;
  const onTitleBlurRef = useRef(onTitleBlur);
  onTitleBlurRef.current = onTitleBlur;
  const onTitleDraftChangeRef = useRef(onTitleDraftChange);
  onTitleDraftChangeRef.current = onTitleDraftChange;
  const isTitleSavingRef = useRef(isTitleSaving);
  isTitleSavingRef.current = isTitleSaving;
  // Escape でキャンセルした場合に saveTitleOnBlur での保存をスキップするフラグ
  const cancelRef = useRef(false);

  // サーバーから title が更新されたとき（保存成功後など）、未フォーカス状態なら同期
  useEffect(() => {
    if (!isFocusedRef.current) {
      setLocalTitle(title);
      onTitleDraftChangeRef.current?.(title);
    }
  }, [title]);

  // 保存失敗時: title prop は変わらないため別 effect でリセット
  // - titleRef を使うことで title を deps に含めず、title 変化による誤発火を防ぐ
  // - フォーカス中の場合はリセットしない（再フォーカスして入力中のケースを保護）
  useEffect(() => {
    if (
      titleSaveFailureCount != null &&
      titleSaveFailureCount > 0 &&
      !isFocusedRef.current
    ) {
      setLocalTitle(titleRef.current);
      onTitleDraftChangeRef.current?.(titleRef.current);
    }
  }, [titleSaveFailureCount]);

  const enterTitleEditing = useCallback(() => {
    isFocusedRef.current = true;
    setIsFocused(true);
    setTooltipOpen(false);
    // 前回 Escape でキャンセルした状態が残っていた場合に備えてリセット
    cancelRef.current = false;
  }, []);

  const updateLocalTitle = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const nextTitle = e.target.value;
    setLocalTitle(nextTitle);
    onTitleDraftChangeRef.current?.(nextTitle);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    // IME 変換中（日本語・中国語・韓国語などの確定操作）は無視する
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      // キャンセル: 元の値に戻してフォーカスを外す（saveTitleOnBlur で保存しないよう cancelRef を立てる）
      cancelRef.current = true;
      setLocalTitle(titleRef.current);
      onTitleDraftChangeRef.current?.(titleRef.current);
      e.currentTarget.blur();
    }
  }, []);

  const saveTitleOnBlur = useCallback(() => {
    isFocusedRef.current = false;
    setIsFocused(false);
    if (cancelRef.current) {
      cancelRef.current = false;
      return;
    }
    if (!onTitleBlurRef.current) return;
    const trimmed = localTitleRef.current.trim();
    if (!trimmed) {
      // 空文字は保存せず元の値に戻す（API バリデーション: min(1)）
      setLocalTitle(titleRef.current.trim());
      onTitleDraftChangeRef.current?.(titleRef.current.trim());
      return;
    }
    // 変更がない場合: 余分な空白を取り除いて表示を正規化してから終了
    if (trimmed === titleRef.current.trim()) {
      setLocalTitle(trimmed);
      onTitleDraftChangeRef.current?.(trimmed);
      return;
    }
    // 保存中はリクエストを送らない
    if (isTitleSavingRef.current) {
      setLocalTitle(titleRef.current);
      onTitleDraftChangeRef.current?.(titleRef.current);
      return;
    }
    onTitleBlurRef.current(trimmed);
  }, []);

  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        {onTitleBlur ? (
          <Tooltip
            open={isFocused || isTitleSaving ? false : tooltipOpen}
            onOpenChange={setTooltipOpen}
          >
            <TooltipTrigger asChild>
              <div className="relative">
                {/* sr-only heading でスクリーンリーダーのヘッディングナビゲーションを保持 */}
                <h1 className="sr-only">{title}</h1>
                <input
                  type="text"
                  aria-label="フォーム名"
                  placeholder="フォーム名を入力"
                  className="w-full rounded-sm bg-transparent pr-7 text-2xl font-semibold outline-none enabled:hover:outline enabled:hover:outline-2 enabled:hover:outline-muted-foreground/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring focus-visible:ring-0 disabled:cursor-default disabled:opacity-60"
                  value={localTitle}
                  maxLength={255}
                  disabled={isTitleSaving}
                  aria-busy={isTitleSaving}
                  onChange={updateLocalTitle}
                  onKeyDown={handleKeyDown}
                  onFocus={enterTitleEditing}
                  onBlur={saveTitleOnBlur}
                />
                {isTitleSaving && (
                  <Spinner className="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground" />
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              クリックして編集
            </TooltipContent>
          </Tooltip>
        ) : (
          <h1 className="text-2xl font-semibold">{title}</h1>
        )}
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
