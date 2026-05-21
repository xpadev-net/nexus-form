import {
  type ChangeEvent,
  type ComponentProps,
  type CompositionEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Input } from "./input";

type CompositionAwareInputProps = ComponentProps<typeof Input> & {
  /** IME変換中を含むローカル値の変更通知（文字数カウンター等に使用） */
  onLocalChange?: (value: string) => void;
};

/**
 * IME変換中の再レンダリングによる変換中断を防ぐInputラッパー。
 * ローカルstateで入力値を管理し、IME変換中は親への通知を遅延させる。
 */
function CompositionAwareInput({
  value,
  onChange,
  onCompositionStart,
  onCompositionEnd,
  onLocalChange,
  ref,
  ...props
}: CompositionAwareInputProps) {
  const [localValue, setLocalValue] = useState(value ?? "");
  const isComposingRef = useRef(false);
  const justEndedCompositionRef = useRef(false);

  // onLocalChangeをrefで保持し、useEffectの依存配列から除外する。
  // インライン関数で渡されても不要なeffect再実行を防ぐ。
  const onLocalChangeRef = useRef(onLocalChange);
  useEffect(() => {
    onLocalChangeRef.current = onLocalChange;
  });

  // 最後に通知した値を追跡し、同値での二重呼び出しを防ぐ。
  const lastNotifiedRef = useRef(String(value ?? ""));

  const notifyLocalChange = (v: string) => {
    if (v !== lastNotifiedRef.current) {
      lastNotifiedRef.current = v;
      onLocalChangeRef.current?.(v);
    }
  };

  useEffect(() => {
    if (!isComposingRef.current) {
      const next = String(value ?? "");
      setLocalValue(next);
      notifyLocalChange(next);
    }
  }, [value]);

  const updateLocalValue = (v: string) => {
    setLocalValue(v);
    notifyLocalChange(v);
  };

  const updateValueFromInput = (e: ChangeEvent<HTMLInputElement>) => {
    updateLocalValue(e.target.value);
    // IME変換中でない、またはcompositionEnd直後の trailing input イベント
    if (!isComposingRef.current || justEndedCompositionRef.current) {
      justEndedCompositionRef.current = false;
      onChange?.(e);
    }
  };

  const handleCompositionStart = (e: CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = true;
    justEndedCompositionRef.current = false;
    onCompositionStart?.(e);
  };

  const handleCompositionEnd = (e: CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = false;
    // trailing input イベントが来なかった場合のフォールバック用フラグ。
    // updateValueFromInputで消費される。来なければ次のイベントサイクルでリセット。
    justEndedCompositionRef.current = true;
    updateLocalValue((e.target as HTMLInputElement).value);
    onCompositionEnd?.(e);
  };

  return (
    <Input
      ref={ref}
      value={localValue}
      onChange={updateValueFromInput}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
      {...props}
    />
  );
}

export { CompositionAwareInput };
