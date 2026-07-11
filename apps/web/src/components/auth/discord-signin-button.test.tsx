// @vitest-environment jsdom

import {
  fireEvent,
  getByRole,
  getByText,
  queryByRole,
} from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordSignInButton } from "@/components/auth/discord-signin-button";
import { DISCORD_SIGN_IN_ERROR } from "@/hooks/auth/use-auth";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  signInWithDiscord: vi.fn(),
}));

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

const mountedRoots = new Set<Root>();

function renderButton(callbackURL?: string): {
  container: HTMLElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.add(root);

  act(() => {
    root.render(<DiscordSignInButton callbackURL={callbackURL} />);
  });

  return { container, root };
}

function deferred<T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

function getButton(element: Element): HTMLButtonElement {
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error("Expected a native button");
  }
  return element;
}

describe("DiscordSignInButton", () => {
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

  it("passes its callback destination to the sign-in action", async () => {
    mocks.signInWithDiscord.mockResolvedValueOnce(false);
    const { container } = renderButton("/forms/form-1/edit");

    await act(async () => {
      fireEvent.click(
        getByRole(container, "button", { name: "Sign in with Discord" }),
      );
      await Promise.resolve();
    });

    expect(mocks.signInWithDiscord).toHaveBeenCalledWith("/forms/form-1/edit");
  });

  it("keeps the control pending and ignores a double click", async () => {
    const attempt = deferred<boolean>();
    mocks.signInWithDiscord.mockReturnValueOnce(attempt.promise);
    const { container } = renderButton();

    act(() => {
      const signInButton = getByRole(container, "button", {
        name: "Sign in with Discord",
      });
      fireEvent.click(signInButton);
      fireEvent.click(signInButton);
    });

    expect(mocks.signInWithDiscord).toHaveBeenCalledTimes(1);
    const pendingButton = getByRole(container, "button", {
      name: "Signing in...",
    });
    expect(getButton(pendingButton).disabled).toBe(true);
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      attempt.resolve(false);
      await attempt.promise;
    });

    expect(
      getButton(
        getByRole(container, "button", {
          name: "Sign in with Discord",
        }),
      ).disabled,
    ).toBe(false);
  });

  it("announces a rejected sign-in with safe copy and allows retry", async () => {
    mocks.signInWithDiscord
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(false);
    const { container } = renderButton();

    await act(async () => {
      fireEvent.click(
        getByRole(container, "button", { name: "Sign in with Discord" }),
      );
      await Promise.resolve();
    });

    const alert = getByRole(container, "alert");
    expect(getByText(alert, DISCORD_SIGN_IN_ERROR)).toBeTruthy();
    expect(alert.textContent).not.toContain("network unavailable");

    await act(async () => {
      fireEvent.click(
        getByRole(container, "button", { name: "Sign in with Discord" }),
      );
      await Promise.resolve();
    });

    expect(mocks.signInWithDiscord).toHaveBeenCalledTimes(2);
    expect(queryByRole(container, "alert")).toBeNull();
  });

  it("keeps the control pending after a redirect handoff starts", async () => {
    const attempt = deferred<boolean>();
    mocks.signInWithDiscord.mockReturnValueOnce(attempt.promise);
    const { container } = renderButton();

    act(() => {
      fireEvent.click(
        getByRole(container, "button", { name: "Sign in with Discord" }),
      );
    });

    await act(async () => {
      attempt.resolve(true);
      await attempt.promise;
    });

    const pendingButton = getByRole(container, "button", {
      name: "Signing in...",
    });
    expect(getButton(pendingButton).disabled).toBe(true);
    expect(pendingButton.getAttribute("aria-busy")).toBe("true");

    act(() => {
      fireEvent.click(pendingButton);
    });

    expect(mocks.signInWithDiscord).toHaveBeenCalledTimes(1);
  });
});
