import { providerRegistry } from "@nexus-form/integrations";
import { listValidationProvidersResponseSchema } from "@nexus-form/shared";
import { discordProvider } from "@nexus-form/validation-provider-discord";
import { githubProvider } from "@nexus-form/validation-provider-github";
import { twitterProvider } from "@nexus-form/validation-provider-twitter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/dual-auth", () => ({
  withDualAuth:
    () =>
    async (_c: unknown, next: () => Promise<void>): Promise<void> =>
      next(),
}));

const providerNames = ["discord", "github", "twitter"];

function resetBuiltinProviders(): void {
  for (const name of providerNames) {
    providerRegistry.unregister(name);
  }
}

describe("validationProvidersRouter", () => {
  beforeEach(() => {
    resetBuiltinProviders();
    providerRegistry.register(discordProvider);
    providerRegistry.register(githubProvider);
    providerRegistry.register(twitterProvider);
  });

  afterEach(() => {
    resetBuiltinProviders();
  });

  it("returns provider input guides, required config, and permission failure hints", async () => {
    const { validationProvidersRouter } = await import(
      "../routes/validation-providers"
    );

    const response = await validationProvidersRouter.request("/");
    const body = listValidationProvidersResponseSchema.parse(
      await response.json(),
    );

    expect(response.status).toBe(200);
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "discord",
          rules: expect.arrayContaining([
            expect.objectContaining({
              name: "guild_member",
              inputHint: expect.stringContaining("必要権限が不足"),
              configFields: expect.arrayContaining([
                expect.objectContaining({
                  name: "guildId",
                  required: true,
                  description: expect.stringContaining("検証用Botが参加済み"),
                }),
              ]),
            }),
          ]),
        }),
        expect.objectContaining({
          name: "github",
          rules: expect.arrayContaining([
            expect.objectContaining({
              name: "user_exists",
              inputHint: expect.stringContaining("installation権限"),
            }),
          ]),
        }),
        expect.objectContaining({
          name: "twitter",
          rules: expect.arrayContaining([
            expect.objectContaining({
              name: "user_exists",
              inputHint: expect.stringContaining("Users lookup権限"),
            }),
          ]),
        }),
      ]),
    );
  });
});
