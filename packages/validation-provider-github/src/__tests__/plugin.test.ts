import { describe, expect, it } from "vitest";
import { githubProvider } from "../plugin";

describe("githubProvider.rules.user_exists.inputSchema", () => {
  it("accepts usernames matching the advertised GitHub pattern", () => {
    const result =
      githubProvider.rules.user_exists?.inputSchema.safeParse("octo-cat");

    expect(result?.success).toBe(true);
  });

  it("accepts usernames at the minimum and maximum GitHub lengths", () => {
    const schema = githubProvider.rules.user_exists?.inputSchema;

    expect(schema?.safeParse("a").success).toBe(true);
    expect(schema?.safeParse("a".repeat(39)).success).toBe(true);
  });

  it("rejects usernames outside the GitHub length boundaries", () => {
    const schema = githubProvider.rules.user_exists?.inputSchema;

    expect(schema?.safeParse("").success).toBe(false);
    expect(schema?.safeParse("a".repeat(40)).success).toBe(false);
  });

  it("rejects usernames with characters outside the advertised pattern", () => {
    const result =
      githubProvider.rules.user_exists?.inputSchema.safeParse("octo/cat");

    expect(result?.success).toBe(false);
  });

  it("rejects usernames with a trailing hyphen", () => {
    const result =
      githubProvider.rules.user_exists?.inputSchema.safeParse("octocat-");

    expect(result?.success).toBe(false);
  });

  it("rejects usernames with a leading hyphen", () => {
    const result =
      githubProvider.rules.user_exists?.inputSchema.safeParse("-octocat");

    expect(result?.success).toBe(false);
  });
});
