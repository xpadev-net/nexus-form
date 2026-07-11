import { beforeEach, describe, expect, it, vi } from "vitest";
import { DISCORD_SIGN_IN_ERROR, useAuth } from "@/hooks/auth/use-auth";
import { authClient } from "@/lib/auth-client";

const { FRONTEND_BASE_URL_FOR_TEST } = vi.hoisted(() => ({
  FRONTEND_BASE_URL_FOR_TEST: "https://frontend.test.example.com/app",
}));

vi.mock("@/lib/runtime-config", () => ({
  getRuntimeConfigValue: vi.fn(() => FRONTEND_BASE_URL_FOR_TEST),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: vi.fn(() => ({ data: null, isPending: false })),
    signIn: {
      social: vi.fn(),
    },
    signOut: vi.fn(),
  },
}));

const signInSocialMock = vi.mocked(authClient.signIn.social);

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes safe Discord callback URLs through", async () => {
    const { signInWithDiscord } = useAuth();

    await signInWithDiscord("/forms/form-1/edit?tab=responses");

    expect(signInSocialMock).toHaveBeenCalledWith({
      provider: "discord",
      callbackURL: `${FRONTEND_BASE_URL_FOR_TEST}/forms/form-1/edit?tab=responses`,
    });
  });

  it("falls back when Discord callback URL is unsafe", async () => {
    const { signInWithDiscord } = useAuth();

    await signInWithDiscord("https://example.com/phish");

    expect(signInSocialMock).toHaveBeenCalledWith({
      provider: "discord",
      callbackURL: `${FRONTEND_BASE_URL_FOR_TEST}/`,
    });
  });

  it("normalizes a rejected Discord sign-in promise", async () => {
    signInSocialMock.mockRejectedValueOnce(new Error("network unavailable"));

    const { signInWithDiscord } = useAuth();

    await expect(signInWithDiscord()).rejects.toThrow(DISCORD_SIGN_IN_ERROR);
  });

  it("normalizes an error returned in a resolved Discord sign-in result", async () => {
    signInSocialMock.mockResolvedValueOnce({
      error: { message: "Discord provider unavailable" },
    });

    const { signInWithDiscord } = useAuth();

    await expect(signInWithDiscord()).rejects.toThrow(DISCORD_SIGN_IN_ERROR);
  });

  it("reports when Discord hands the browser off to its redirect URL", async () => {
    signInSocialMock.mockResolvedValueOnce({
      data: {
        redirect: true,
        url: "https://discord.com/oauth2/authorize?client_id=test",
      },
    });

    const { signInWithDiscord } = useAuth();

    await expect(signInWithDiscord("/forms/form-1/edit")).resolves.toBe(true);
  });
});
