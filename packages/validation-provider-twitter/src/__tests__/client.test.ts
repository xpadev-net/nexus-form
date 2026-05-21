import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTwitterClient } from "../client";

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => ({
      request: requestMock,
    })),
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("getTwitterClient", () => {
  it("uses the current bearer token on each default client creation", () => {
    vi.stubEnv("TWITTER_BEARER_TOKEN", "old-token");
    getTwitterClient();

    vi.stubEnv("TWITTER_BEARER_TOKEN", "new-token");
    getTwitterClient();

    expect(axios.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer old-token",
        }),
      }),
    );
    expect(axios.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer new-token",
        }),
      }),
    );
  });

  it("rejects malformed successful user lookup responses", async () => {
    vi.stubEnv("TWITTER_BEARER_TOKEN", "token");
    requestMock.mockResolvedValueOnce({
      data: {
        data: { id: "123" },
      },
    });
    const client = getTwitterClient();

    await expect(client.getUserByUsername("username")).rejects.toThrow(
      "Twitter API returned malformed user data",
    );
  });

  it("treats null user lookup data as a missing user", async () => {
    vi.stubEnv("TWITTER_BEARER_TOKEN", "token");
    requestMock.mockResolvedValueOnce({
      data: {
        data: null,
      },
    });
    const client = getTwitterClient();

    await expect(client.getUserByUsername("username")).resolves.toBeNull();
  });

  it("rejects successful user lookup responses with malformed profile image URLs", async () => {
    vi.stubEnv("TWITTER_BEARER_TOKEN", "token");
    requestMock.mockResolvedValueOnce({
      data: {
        data: {
          id: "123",
          username: "username",
          name: "User Name",
          profile_image_url: "not-a-url",
        },
      },
    });
    const client = getTwitterClient();

    await expect(client.getUserByUsername("username")).rejects.toThrow(
      "Twitter API returned malformed user data",
    );
  });
});
