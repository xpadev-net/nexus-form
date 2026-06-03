// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPublicFormUrl } from "@/lib/forms/public-url";
import { FormSharingSection } from "./form-sharing-section";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
}));

vi.mock("@/components/forms/share-link-manager", () => ({
  ShareLinkManager: () => null,
}));

vi.mock("@/components/forms/permission-editor", () => ({
  PermissionEditor: () => null,
}));

vi.mock("@/components/forms/invitation-manager", () => ({
  InvitationManager: () => null,
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function renderSharingSection(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(
      <FormSharingSection
        formId="form-1"
        plateContent="[]"
        publicId="public-1"
      />,
    );
  });
  return root;
}

describe("FormSharingSection public URL surface", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: mocks.writeText.mockResolvedValue(undefined) },
    });
  });

  it("shows and copies the same current public URL used by settings surfaces", async () => {
    const container = document.createElement("div");
    const root = renderSharingSection(container);
    const expectedUrl = buildPublicFormUrl("public-1");

    const publicUrlInput = container.querySelector<HTMLInputElement>(
      "#sharing-public-url",
    );
    expect(publicUrlInput?.value).toBe(expectedUrl);
    expect(container.textContent).toContain(
      "設定タブと同じ現在の公開 URL です。",
    );

    const copyButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="現在の公開 URL をコピー"]',
    );
    expect(copyButton).not.toBeNull();
    await act(async () => {
      copyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.writeText).toHaveBeenCalledWith(expectedUrl);
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "公開 URL をコピーしました",
    );

    act(() => root.unmount());
  });
});
