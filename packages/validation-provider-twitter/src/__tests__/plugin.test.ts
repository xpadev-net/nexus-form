import { describe, expect, it } from "vitest";
import { twitterProvider } from "../plugin";

describe("twitterProvider.rules.user_exists.inputSchema", () => {
  it("accepts usernames matching the advertised Twitter pattern", () => {
    const result =
      twitterProvider.rules.user_exists?.inputSchema.safeParse("User_Name1");

    expect(result?.success).toBe(true);
  });

  it("accepts usernames at the minimum and maximum Twitter lengths", () => {
    const schema = twitterProvider.rules.user_exists?.inputSchema;

    expect(schema?.safeParse("a").success).toBe(true);
    expect(schema?.safeParse("a".repeat(15)).success).toBe(true);
  });

  it("rejects empty usernames", () => {
    const result = twitterProvider.rules.user_exists?.inputSchema.safeParse("");

    expect(result?.success).toBe(false);
  });

  it("rejects usernames with characters outside the advertised pattern", () => {
    const result =
      twitterProvider.rules.user_exists?.inputSchema.safeParse("user/name");

    expect(result?.success).toBe(false);
  });

  it("rejects usernames longer than fifteen characters", () => {
    const result =
      twitterProvider.rules.user_exists?.inputSchema.safeParse(
        "sixteen_chars_123",
      );

    expect(result?.success).toBe(false);
  });
});
