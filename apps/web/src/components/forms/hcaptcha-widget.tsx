import HCaptcha from "@hcaptcha/react-hcaptcha";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

interface HCaptchaWidgetProps {
  /** トークン取得時のコールバック */
  onVerify: (token: string) => void;
  /** エラー時のコールバック */
  onError?: () => void;
  /** 期限切れ時のコールバック */
  onExpire?: () => void;
  /** ウィジェットのサイズ */
  size?: "compact" | "normal" | "invisible";
  /** テーマ */
  theme?: "light" | "dark";
  /** カスタムクラス名 */
  className?: string;
}

export interface HCaptchaWidgetHandle {
  reset: () => void;
}

export const HCaptchaWidget = forwardRef<
  HCaptchaWidgetHandle,
  HCaptchaWidgetProps
>(function HCaptchaWidget(
  {
    onVerify,
    onError,
    onExpire,
    size = "normal",
    theme = "light",
    className = "",
  },
  ref,
) {
  const captchaRef = useRef<HCaptcha>(null);
  const [error, setError] = useState<string | null>(null);
  const siteKey = import.meta.env.VITE_HCAPTCHA_SITE_KEY as string | undefined;

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        captchaRef.current?.resetCaptcha();
        setError(null);
      },
    }),
    [],
  );

  const handleVerify = useCallback(
    (token: string) => {
      setError(null);
      onVerify(token);
    },
    [onVerify],
  );

  const handleError = useCallback(() => {
    setError("ボット検証に失敗しました。もう一度お試しください。");
    onError?.();
  }, [onError]);

  const handleExpire = useCallback(() => {
    setError("検証の有効期限が切れました。もう一度お試しください。");
    captchaRef.current?.resetCaptcha();
    onExpire?.();
  }, [onExpire]);

  if (!siteKey) {
    return (
      <p className={`text-sm text-destructive ${className}`}>
        hCaptchaの設定が正しくありません。管理者にお問い合わせください。
      </p>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <section
        className="flex items-center justify-center"
        aria-label="セキュリティ確認"
      >
        <HCaptcha
          ref={captchaRef}
          sitekey={siteKey}
          onVerify={handleVerify}
          onError={handleError}
          onExpire={handleExpire}
          size={size}
          theme={theme}
          languageOverride="ja"
        />
      </section>
    </div>
  );
});
