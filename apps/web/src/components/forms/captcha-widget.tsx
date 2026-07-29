import HCaptcha from "@hcaptcha/react-hcaptcha";
import {
  type CaptchaProvider,
  captchaProviderSchema,
} from "@nexus-form/shared";
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { getRuntimeConfigValue } from "@/lib/runtime-config";

interface CaptchaWidgetProps {
  onVerify: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
  size?: "compact" | "normal" | "invisible";
  theme?: "light" | "dark";
  className?: string;
  ref?: Ref<CaptchaWidgetHandle>;
}

export interface CaptchaWidgetHandle {
  reset: () => void;
}

type TurnstileWidgetId = string;

type TurnstileApi = {
  render: (
    container: string | HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
      language: string;
      size: "compact" | "normal" | "invisible";
      theme: "light" | "dark";
    },
  ) => TurnstileWidgetId | undefined;
  remove: (widgetId: TurnstileWidgetId) => void;
  reset: (widgetId: TurnstileWidgetId) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const turnstileScriptId = "nexus-form-turnstile-script";
const turnstileScriptSrc =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let turnstileScriptPromise: Promise<void> | null = null;

function getCaptchaProvider(): CaptchaProvider | null {
  const provider = getRuntimeConfigValue(
    "captchaProvider",
    import.meta.env.VITE_CAPTCHA_PROVIDER,
    "hcaptcha",
  );
  const result = captchaProviderSchema.safeParse(provider);
  return result.success ? result.data : null;
}

function loadTurnstileScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const completeScriptLoad = (script: HTMLScriptElement) => {
      script.dataset.loadState = "loaded";
      resolve();
    };
    const failScriptLoad = (script: HTMLScriptElement) => {
      script.dataset.loadState = "failed";
      script.remove();
      turnstileScriptPromise = null;
      reject(new Error("Turnstile script failed to load"));
    };

    const existingScript = document.getElementById(turnstileScriptId);
    if (existingScript) {
      const script = existingScript as HTMLScriptElement;
      if (window.turnstile) {
        resolve();
        return;
      }
      if (existingScript.dataset.loadState === "loaded") {
        failScriptLoad(script);
        return;
      }
      if (existingScript.dataset.loadState === "failed") {
        existingScript.remove();
        turnstileScriptPromise = null;
        loadTurnstileScript().then(resolve, reject);
        return;
      }

      script.addEventListener("load", () => completeScriptLoad(script), {
        once: true,
      });
      existingScript.addEventListener("error", () => failScriptLoad(script), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.id = turnstileScriptId;
    script.src = turnstileScriptSrc;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => completeScriptLoad(script), {
      once: true,
    });
    script.addEventListener("error", () => failScriptLoad(script), {
      once: true,
    });
    document.head.append(script);
  });

  return turnstileScriptPromise;
}

function HCaptchaWidget({
  onError,
  onExpire,
  onVerify,
  size,
  theme,
  className,
  ref,
}: CaptchaWidgetProps) {
  const captchaRef = useRef<HCaptcha>(null);
  const containerClassName = className ?? "";
  const [error, setError] = useState<string | null>(null);
  const siteKey = getRuntimeConfigValue(
    "hcaptchaSiteKey",
    import.meta.env.VITE_HCAPTCHA_SITE_KEY,
  );

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
      <p className={`text-sm text-destructive ${containerClassName}`}>
        hCaptchaの設定が正しくありません。管理者にお問い合わせください。
      </p>
    );
  }

  return (
    <div className={`space-y-2 ${containerClassName}`}>
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
}

function TurnstileWidget({
  onError,
  onExpire,
  onVerify,
  size,
  theme,
  className,
  ref,
}: CaptchaWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const containerClassName = className ?? "";
  const [error, setError] = useState<string | null>(null);
  const siteKey = getRuntimeConfigValue(
    "turnstileSiteKey",
    import.meta.env.VITE_TURNSTILE_SITE_KEY,
  );

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        if (widgetIdRef.current) {
          window.turnstile?.reset(widgetIdRef.current);
        }
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
    onExpire?.();
  }, [onExpire]);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;

    let mounted = true;

    void loadTurnstileScript()
      .then(() => {
        if (!mounted || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current =
          window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            callback: handleVerify,
            "error-callback": handleError,
            "expired-callback": handleExpire,
            language: "ja",
            size: size ?? "normal",
            theme: theme ?? "light",
          }) ?? null;
      })
      .catch(() => {
        if (!mounted) return;
        handleError();
      });

    return () => {
      mounted = false;
      if (widgetIdRef.current) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [handleError, handleExpire, handleVerify, siteKey, size, theme]);

  if (!siteKey) {
    return (
      <p className={`text-sm text-destructive ${containerClassName}`}>
        Turnstileの設定が正しくありません。管理者にお問い合わせください。
      </p>
    );
  }

  return (
    <div className={`space-y-2 ${containerClassName}`}>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <section
        className="flex items-center justify-center"
        aria-label="セキュリティ確認"
      >
        <div ref={containerRef} />
      </section>
    </div>
  );
}

export function CaptchaWidget(props: CaptchaWidgetProps) {
  const provider = getCaptchaProvider();

  if (!provider) {
    return (
      <p className={`text-sm text-destructive ${props.className ?? ""}`}>
        CAPTCHAのprovider設定が正しくありません。管理者にお問い合わせください。
      </p>
    );
  }

  return provider === "turnstile" ? (
    <TurnstileWidget {...props} />
  ) : (
    <HCaptchaWidget {...props} />
  );
}
