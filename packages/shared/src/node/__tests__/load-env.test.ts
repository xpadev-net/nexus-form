import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEnvFileSync } from "../load-env";

const ENV_KEY = "NEXUS_FORM_LOAD_ENV_TEST_VALUE";

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe("loadEnvFileSync", () => {
  it("loads dotenv values synchronously from the caller module context", async () => {
    const envDir = await mkdtemp(join(tmpdir(), "nexus-form-env-"));
    const envPath = join(envDir, ".env.local");
    await writeFile(envPath, `${ENV_KEY}=from-dotenv\n`, "utf8");

    loadEnvFileSync({
      enabled: true,
      path: envPath,
      moduleUrl: import.meta.url,
    });

    expect(process.env[ENV_KEY]).toBe("from-dotenv");
  });

  it("does not read dotenv when disabled", async () => {
    const envDir = await mkdtemp(join(tmpdir(), "nexus-form-env-"));
    const envPath = join(envDir, ".env.local");
    await writeFile(envPath, `${ENV_KEY}=disabled\n`, "utf8");

    loadEnvFileSync({
      enabled: false,
      path: envPath,
      moduleUrl: import.meta.url,
    });

    expect(process.env[ENV_KEY]).toBeUndefined();
  });

  it("warns when the dotenv file cannot be loaded", () => {
    const logger = {
      warn: vi.fn(),
    };

    loadEnvFileSync({
      enabled: true,
      path: join(tmpdir(), "missing-nexus-form-env-file"),
      moduleUrl: import.meta.url,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[load-env] Failed to load"),
    );
  });
});
