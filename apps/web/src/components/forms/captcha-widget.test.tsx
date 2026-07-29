// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CaptchaWidget } from "./captcha-widget";

vi.mock("@hcaptcha/react-hcaptcha", () => ({
  default: () => <div data-testid="hcaptcha-widget" />,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderCaptcha(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<CaptchaWidget onVerify={vi.fn()} />);
  });
  return root;
}

describe("CaptchaWidget", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
