import { isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAuth } from "./require-auth";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    getSession: mocks.getSession,
  },
}));

describe("requireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects unauthenticated users to login with a safe return path", async () => {
    mocks.getSession.mockResolvedValueOnce({ data: null });

    await expect(
      requireAuth({ location: { href: "/forms/form-1/edit?tab=responses" } }),
    ).rejects.toMatchObject({
      options: {
        search: { redirect: "/forms/form-1/edit?tab=responses" },
        to: "/login",
      },
    });
  });

  it("rejects external return paths when building the login redirect", async () => {
    mocks.getSession.mockResolvedValueOnce({ data: null });

    try {
      await requireAuth({ location: { href: "https://example.com/phish" } });
      throw new Error("requireAuth did not redirect");
    } catch (error) {
      expect(isRedirect(error)).toBe(true);
      expect(error).toMatchObject({
        options: {
          search: { redirect: undefined },
          to: "/login",
        },
      });
    }
  });
});
