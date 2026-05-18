import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ValidationProvider } from "../plugin-interface";
import { ValidationProviderRegistry } from "../provider-registry";
import type { PluginDriftStore, PluginRuntimeManifest } from "../startup";
import { startupPlugins } from "../startup";

class MemoryDriftStore implements PluginDriftStore {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    _mode: "EX",
    _ttlSeconds: number,
  ): Promise<"OK"> {
    this.values.set(key, value);
    return "OK";
  }

  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }
}

function makeProvider(name: string): ValidationProvider {
  return {
    name,
    label: `Label for ${name}`,
    description: `Description for ${name}`,
    rules: {
      default: {
        name: "default",
        label: "Default",
        description: "Default rule",
        inputHint: "Enter value",
        inputSchema: z.string(),
        configSchema: z.object({}),
        metadataSchema: z.object({}),
        validate: async () => ({ isValid: true }),
      },
    },
  };
}

function makeManifest(
  role: PluginRuntimeManifest["role"],
  providers: string[],
  pluginHashes: string[] = [],
): PluginRuntimeManifest {
  return {
    version: 1,
    role,
    providers,
    pluginHashes,
  };
}

describe("startupPlugins plugin drift guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records the current runtime manifest when the peer is not present", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();

    await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        store,
        keyPrefix: "test:plugins",
        ttlSeconds: 60,
      },
    });

    const rawManifest = store.values.get("test:plugins:api");
    expect(rawManifest).toBeDefined();
    expect(JSON.parse(rawManifest ?? "{}")).toMatchObject({
      role: "api",
      providers: ["discord"],
      pluginHashes: [],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("could not find worker manifest"),
    );
  });

  it("passes startup when the peer manifest matches providers and plugin hashes", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.values.set(
      "test:plugins:worker",
      JSON.stringify(makeManifest("worker", ["discord"])),
    );

    await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        store,
        keyPrefix: "test:plugins",
      },
    });

    expect(store.values.has("test:plugins:api")).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Plugin drift guard matched worker"),
    );
  });

  it("records built-in plugin file hashes in the runtime manifest", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pluginDir = await mkdtemp(join(tmpdir(), "nexus-form-plugin-"));
    const pluginSource = `
const passthroughSchema = {
  parse: (value) => value,
  safeParse: (value) => ({ success: true, data: value }),
};

export default {
  name: "builtin_discord",
  label: "Builtin Discord",
  description: "Builtin Discord provider",
  rules: {
    default: {
      name: "default",
      label: "Default",
      description: "Default rule",
      inputHint: "Enter value",
      inputSchema: passthroughSchema,
      configSchema: passthroughSchema,
      metadataSchema: passthroughSchema,
      validate: async () => ({ isValid: true }),
    },
  },
};
`;
    const pluginPath = join(pluginDir, "builtin-discord.mjs");
    await writeFile(pluginPath, pluginSource);
    const expectedHash = createHash("sha256")
      .update(pluginSource)
      .digest("hex");
    const registry = new ValidationProviderRegistry();
    const store = new MemoryDriftStore();

    await startupPlugins(registry, {
      builtinPlugins: [pluginPath],
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        store,
        keyPrefix: "test:plugins",
      },
    });

    const rawManifest = store.values.get("test:plugins:api");
    expect(JSON.parse(rawManifest ?? "{}")).toMatchObject({
      providers: ["builtin_discord"],
      pluginHashes: [expectedHash],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("could not find worker manifest"),
    );
  });

  it("fails startup when the peer manifest has different providers", async () => {
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.values.set(
      "test:plugins:worker",
      JSON.stringify(makeManifest("worker", ["github"])),
    );

    await expect(
      startupPlugins(registry, {
        logPrefix: "api",
        pluginDriftGuard: {
          role: "api",
          store,
          keyPrefix: "test:plugins",
        },
      }),
    ).rejects.toThrow("Plugin drift detected");
    expect(store.values.has("test:plugins:api")).toBe(false);
  });

  it("fails startup when the peer manifest has different plugin hashes", async () => {
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.values.set(
      "test:plugins:worker",
      JSON.stringify(makeManifest("worker", ["discord"], ["hash-a"])),
    );

    await expect(
      startupPlugins(registry, {
        logPrefix: "api",
        pluginDriftGuard: {
          role: "api",
          store,
          keyPrefix: "test:plugins",
        },
      }),
    ).rejects.toThrow("pluginHashes");
    expect(store.values.has("test:plugins:api")).toBe(false);
  });

  it("fails startup when the peer manifest role does not match the key", async () => {
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.values.set(
      "test:plugins:worker",
      JSON.stringify(makeManifest("api", ["discord"])),
    );

    await expect(
      startupPlugins(registry, {
        logPrefix: "api",
        pluginDriftGuard: {
          role: "api",
          store,
          keyPrefix: "test:plugins",
        },
      }),
    ).rejects.toThrow("expected worker manifest");
  });

  it.each([
    {
      label: "non-JSON peer manifest",
      peerManifest: "not-json",
      error: "non-JSON worker manifest",
    },
    {
      label: "invalid peer manifest",
      peerManifest: JSON.stringify({
        version: 1,
        role: "worker",
        providers: ["discord"],
      }),
      error: "invalid worker manifest",
    },
  ])("cleans up current manifest after $label", async ({
    peerManifest,
    error,
  }) => {
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.values.set("test:plugins:worker", peerManifest);

    await expect(
      startupPlugins(registry, {
        logPrefix: "api",
        pluginDriftGuard: {
          role: "api",
          store,
          keyPrefix: "test:plugins",
        },
      }),
    ).rejects.toThrow(error);
    expect(store.values.has("test:plugins:api")).toBe(false);
  });

  it.each([
    {
      label: "non-JSON peer manifest",
      peerManifest: "not-json",
      warning: "non-JSON worker manifest",
    },
    {
      label: "invalid peer manifest",
      peerManifest: JSON.stringify({
        version: 1,
        role: "worker",
        providers: ["discord"],
      }),
      warning: "invalid worker manifest",
    },
    {
      label: "wrong peer role",
      peerManifest: JSON.stringify(makeManifest("api", ["discord"])),
      warning: "expected worker manifest",
    },
    {
      label: "provider drift",
      peerManifest: JSON.stringify(makeManifest("worker", ["github"])),
      warning: "Plugin drift detected",
    },
  ])("warns and continues with failOnMismatch=false for $label", async ({
    peerManifest,
    warning,
  }) => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.values.set("test:plugins:worker", peerManifest);

    await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        store,
        keyPrefix: "test:plugins",
        failOnMismatch: false,
      },
    });

    expect(store.values.has("test:plugins:api")).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(warning));
  });

  it("warns and continues when peer manifest read fails with failOnMismatch=false", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.get = async () => {
      throw new Error("Redis unavailable");
    };

    await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        store,
        keyPrefix: "test:plugins",
        failOnMismatch: false,
      },
    });

    expect(store.values.has("test:plugins:api")).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("warning-only check failed"),
      expect.any(Error),
    );
  });

  it("warns and continues when current manifest write fails with failOnMismatch=false", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.set = async () => {
      throw new Error("Redis write unavailable");
    };

    await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        store,
        keyPrefix: "test:plugins",
        failOnMismatch: false,
      },
    });

    expect(store.values.has("test:plugins:api")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("warning-only check failed"),
      expect.any(Error),
    );
  });
});
