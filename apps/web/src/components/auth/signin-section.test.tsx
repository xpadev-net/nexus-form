// @vitest-environment jsdom

import { fireEvent, getByRole } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInSection } from "@/components/auth/signin-section";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  signInWithDiscord: vi.fn(),
}));

const mountedRoots = new Set<Root>();

vi.mock("@/hooks/auth/use-auth", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/auth/use-auth")>(
    "@/hooks/auth/use-auth",
  );
  return {
    ...actual,
    useAuth: () => ({
      signInWithDiscord: mocks.signInWithDiscord,
    }),
  };
});

vi.mock("@/components/auth/invitation-code-form", () => ({
  InvitationCodeForm: () => <div>Invitation code form</div>,
}));

vi.mock("@/lib/brand-config", () => ({
  brandConfig: {
    privacyUrl: null,
    termsUrl: null,
  },
}));

function renderSection(callbackURL?: string): {
  container: HTMLElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.add(root);

  act(() => {
    root.render(<SignInSection callbackURL={callbackURL} />);
  });

  return { container, root };
}

describe("SignInSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
  });

  afterEach(() => {
    for (const root of mountedRoots) {
      act(() => root.unmount());
    }
    mountedRoots.clear();
    document.body.replaceChildren();
  });

  it("exposes one named Discord sign-in control with its callback destination", async () => {
    mocks.signInWithDiscord.mockResolvedValueOnce(false);
    const { container } = renderSection("/forms/form-1/edit");

    const signInButton = getByRole(container, "button", {
      name: "Sign in with Discord",
    });
    expect(signInButton).toBeTruthy();

    await act(async () => {
      fireEvent.click(signInButton);
      await Promise.resolve();
    });

    expect(mocks.signInWithDiscord).toHaveBeenCalledWith("/forms/form-1/edit");
  });
});
