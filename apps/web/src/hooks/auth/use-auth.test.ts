import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/auth/use-auth";
import { authClient } from "@/lib/auth-client";

const { FRONTEND_BASE_URL_FOR_TEST } = vi.hoisted(() => ({
  FRONTEND_BASE_URL_FOR_TEST: "https://frontend.test.example.com",
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
});
