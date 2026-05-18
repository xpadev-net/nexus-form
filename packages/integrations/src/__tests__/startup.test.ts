import { describe, expect, it, vi } from "vitest";
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
});
