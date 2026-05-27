import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "@/hooks/auth/use-auth";
import { authClient } from "@/lib/auth-client";

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
      callbackURL: "http://localhost:3000/forms/form-1/edit?tab=responses",
    });
  });

  it("falls back when Discord callback URL is unsafe", async () => {
    const { signInWithDiscord } = useAuth();

    await signInWithDiscord("https://example.com/phish");

    expect(signInSocialMock).toHaveBeenCalledWith({
      provider: "discord",
      callbackURL: "http://localhost:3000/",
    });
  });
});
