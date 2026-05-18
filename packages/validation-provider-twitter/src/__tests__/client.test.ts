import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTwitterClient } from "../client";

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => ({
      request: vi.fn(),
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
});
