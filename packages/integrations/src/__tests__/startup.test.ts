import { createHash, randomUUID } from "node:crypto";
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
  readonly setCalls: Array<{ key: string; ttlSeconds: number }> = [];

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    _mode: "EX",
    ttlSeconds: number,
  ): Promise<"OK"> {
    this.setCalls.push({ key, ttlSeconds });
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

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

describe("startupPlugins built-in plugin loading", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("fails startup when a built-in plugin file cannot be read", async () => {
    const registry = new ValidationProviderRegistry();
    const missingPlugin = join(
      tmpdir(),
      `nexus-form-missing-plugin-${randomUUID()}.mjs`,
    );

    await expect(
      startupPlugins(registry, {
        builtinPlugins: [missingPlugin],
        logPrefix: "api",
      }),
    ).rejects.toThrow("Failed to load built-in plugin");
    expect(registry.getNames()).toEqual([]);
  });

  it("fails startup when a built-in plugin has an invalid provider interface", async () => {
    const pluginDir = await mkdtemp(join(tmpdir(), "nexus-form-plugin-"));
    const pluginPath = join(pluginDir, "invalid-builtin.mjs");
    await writeFile(
      pluginPath,
      `
export default {
  name: "invalid_builtin",
  label: "Invalid Builtin",
};
`,
    );
    const registry = new ValidationProviderRegistry();

    await expect(
      startupPlugins(registry, {
        builtinPlugins: [pluginPath],
        logPrefix: "api",
      }),
    ).rejects.toThrow("Invalid provider interface");
    expect(registry.getNames()).toEqual([]);
  });

  it("fails startup when a built-in plugin cannot be registered", async () => {
    const pluginDir = await mkdtemp(join(tmpdir(), "nexus-form-plugin-"));
    const pluginPath = join(pluginDir, "duplicate-builtin.mjs");
    await writeFile(
      pluginPath,
      `
const passthroughSchema = {
  parse: (value) => value,
  safeParse: (value) => ({ success: true, data: value }),
};

export default {
  name: "duplicate_builtin",
  label: "Duplicate Builtin",
  description: "Duplicate built-in provider",
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
`,
    );
    const registry = new ValidationProviderRegistry();
    const registerError = new Error("registry unavailable");
    vi.spyOn(registry, "register").mockImplementation(() => {
      throw registerError;
    });

    await expect(
      startupPlugins(registry, {
        builtinPlugins: [pluginPath],
        logPrefix: "api",
      }),
    ).rejects.toThrow("[api] Failed to register built-in plugin");
    expect(registry.getNames()).toEqual([]);
  });
});

describe("startupPlugins plugin drift guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  it("keeps refreshing the manifest and compares when the peer appears later", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();

    const handle = await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        store,
        keyPrefix: "test:plugins",
        ttlSeconds: 1800,
        refreshIntervalMs: 10,
        failOnMismatch: false,
      },
    });

    store.values.set(
      "test:plugins:worker",
      JSON.stringify(makeManifest("worker", ["github"])),
    );
    await vi.advanceTimersByTimeAsync(10);

    expect(
      store.setCalls.filter((call) => call.key === "test:plugins:api"),
    ).toHaveLength(2);
    expect(store.setCalls.at(-1)?.ttlSeconds).toBe(1800);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Plugin drift detected"),
    );

    await handle?.stop();
  });

  it("treats periodic drift as fatal by default", async () => {
    vi.useFakeTimers();
    const queueMicrotaskSpy = vi.fn();
    vi.stubGlobal("queueMicrotask", queueMicrotaskSpy);
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();

    const handle = await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        store,
        keyPrefix: "test:plugins",
        refreshIntervalMs: 10,
      },
    });

    store.values.set(
      "test:plugins:worker",
      JSON.stringify(makeManifest("worker", ["github"])),
    );
    await vi.advanceTimersByTimeAsync(10);

    expect(queueMicrotaskSpy).toHaveBeenCalledWith(expect.any(Function));
    expect(store.values.has("test:plugins:api")).toBe(true);
    await handle?.stop();
  });

  it("does not escalate an in-flight periodic failure after stop", async () => {
    vi.useFakeTimers();
    const queueMicrotaskSpy = vi.fn();
    vi.stubGlobal("queueMicrotask", queueMicrotaskSpy);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    const peerRead = createDeferred<string | null>();
    let readCount = 0;
    store.get = async (key: string): Promise<string | null> => {
      readCount += 1;
      if (readCount === 1) return null;
      expect(key).toBe("test:plugins:worker");
      return peerRead.promise;
    };

    const handle = await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        store,
        keyPrefix: "test:plugins",
        refreshIntervalMs: 10,
      },
    });

    await vi.advanceTimersByTimeAsync(10);
    const stopped = handle?.stop();
    peerRead.reject(new Error("Redis connection closed"));
    await stopped;

    expect(queueMicrotaskSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "periodic check stopped after an in-flight error",
      ),
      expect.any(Error),
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
    expect(store.values.has("test:plugins:api")).toBe(false);
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
