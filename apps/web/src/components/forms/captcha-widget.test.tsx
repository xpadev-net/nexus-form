// @vitest-environment jsdom

import { act, createRef, type Ref, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptchaWidget, type CaptchaWidgetHandle } from "./captcha-widget";

vi.mock("@hcaptcha/react-hcaptcha", () => ({
  default: ({ ref }: { ref?: Ref<{ resetCaptcha: () => void }> }) => {
    useImperativeHandle(ref, () => ({
      resetCaptcha: vi.fn(),
    }));

    return <div data-testid="hcaptcha-widget" />;
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderCaptcha(
  container: HTMLElement,
  props: Partial<Parameters<typeof CaptchaWidget>[0]> = {},
): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<CaptchaWidget onVerify={vi.fn()} {...props} />);
  });
  return root;
}

describe("CaptchaWidget", () => {
  afterEach(() => {
    act(() => {});
    document.head.replaceChildren();
    document.body.replaceChildren();
    delete window.turnstile;
    delete window.__NEXUS_FORM_CONFIG__;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders hCaptcha by default when provider is not configured", () => {
    vi.stubEnv("VITE_HCAPTCHA_SITE_KEY", "hcaptcha-site-key");
    const container = document.createElement("div");

    const root = renderCaptcha(container);

    expect(container.querySelector("[data-testid='hcaptcha-widget']")).not.toBe(
      null,
    );

    act(() => root.unmount());
  });

  it("renders Turnstile when the provider is configured", async () => {
    vi.stubEnv("VITE_CAPTCHA_PROVIDER", "turnstile");
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "turnstile-site-key");
    const render = vi.fn(() => "turnstile-widget-id");
    const remove = vi.fn();
    const reset = vi.fn();
    window.turnstile = { render, remove, reset };
    const container = document.createElement("div");

    const root = renderCaptcha(container);
    await act(async () => {});

    expect(render).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({
        sitekey: "turnstile-site-key",
        language: "ja",
      }),
    );
    expect(document.getElementById("nexus-form-turnstile-script")).toBe(null);

    act(() => root.unmount());
    expect(remove).toHaveBeenCalledWith("turnstile-widget-id");
  });

  it("shows a configuration error when the selected provider site key is missing", () => {
    vi.stubEnv("VITE_CAPTCHA_PROVIDER", "turnstile");
    const container = document.createElement("div");

    const root = renderCaptcha(container);

    expect(container.textContent).toContain(
      "Turnstileの設定が正しくありません。",
    );

    act(() => root.unmount());
  });

  it("resets the rendered Turnstile widget through the public ref", async () => {
    vi.stubEnv("VITE_CAPTCHA_PROVIDER", "turnstile");
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "turnstile-site-key");
    const render = vi.fn(() => "turnstile-widget-id");
    const remove = vi.fn();
    const reset = vi.fn();
    window.turnstile = { render, remove, reset };
    const container = document.createElement("div");
    const widgetRef = createRef<CaptchaWidgetHandle>();

    const root = renderCaptcha(container, { ref: widgetRef });
    await act(async () => {});
    act(() => {
      widgetRef.current?.reset();
    });

    expect(reset).toHaveBeenCalledWith("turnstile-widget-id");

    act(() => root.unmount());
  });

  it("retries Turnstile script loading after a transient failure", async () => {
    vi.stubEnv("VITE_CAPTCHA_PROVIDER", "turnstile");
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "turnstile-site-key");
    const container = document.createElement("div");

    const firstRoot = renderCaptcha(container);
    const failedScript = document.getElementById("nexus-form-turnstile-script");
    expect(failedScript).not.toBe(null);
    act(() => {
      failedScript?.dispatchEvent(new Event("error"));
    });
    await act(async () => {});
    expect(document.getElementById("nexus-form-turnstile-script")).toBe(null);
    act(() => firstRoot.unmount());

    const secondRoot = renderCaptcha(container);
    expect(document.getElementById("nexus-form-turnstile-script")).not.toBe(
      null,
    );

    act(() => secondRoot.unmount());
  });

  it("shows an explicit configuration error for invalid providers", () => {
    vi.stubEnv("VITE_CAPTCHA_PROVIDER", "turnstyle");
    const container = document.createElement("div");

    const root = renderCaptcha(container);

    expect(container.textContent).toContain(
      "CAPTCHAのprovider設定が正しくありません。",
    );

    act(() => root.unmount());
  });
});
