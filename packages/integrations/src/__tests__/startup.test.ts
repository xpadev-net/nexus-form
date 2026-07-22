import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ValidationProvider } from "../plugin-interface";
import { ValidationProviderRegistry } from "../provider-registry";
import type { PluginDriftStore, PluginRuntimeManifest } from "../startup";
import { normalizeBuiltinPluginPath, startupPlugins } from "../startup";

describe("normalizeBuiltinPluginPath", () => {
  it("converts final src ts path to dist mjs path", () => {
    const sourcePath = "/repo/src/packages/discord/src/plugin.ts";
    expect(normalizeBuiltinPluginPath(sourcePath)).toBe(
      "/repo/src/packages/discord/dist/plugin.mjs",
    );
  });

  it("does not rewrite non-final src segments", () => {
    const sourcePath = "/repo/src/packages/discord/src/module/plugin.ts";
    expect(normalizeBuiltinPluginPath(sourcePath)).toBe(
      "/repo/src/packages/discord/src/module/plugin.ts",
    );
  });

  it("leaves .mjs paths unchanged", () => {
    const sourcePath = "/repo/dist/packages/discord/dist/plugin.mjs";
    expect(normalizeBuiltinPluginPath(sourcePath)).toBe(
      "/repo/dist/packages/discord/dist/plugin.mjs",
    );
  });

  it("does not rewrite production dist paths under ancestor src directories", () => {
    const sourcePath =
      "/usr/src/app/packages/validation-provider-discord/dist/plugin.mjs";
    expect(normalizeBuiltinPluginPath(sourcePath)).toBe(sourcePath);
  });

  it("rewrites final src ts paths under ancestor src directories", () => {
    const sourcePath =
      "/usr/src/app/packages/validation-provider-discord/src/plugin.ts";
    expect(normalizeBuiltinPluginPath(sourcePath)).toBe(
      "/usr/src/app/packages/validation-provider-discord/dist/plugin.mjs",
    );
  });
});

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

  async keys(pattern: string): Promise<string[]> {
    if (!pattern.endsWith("*")) {
      return this.values.has(pattern) ? [pattern] : [];
    }
    const prefix = pattern.slice(0, -1);
    return [...this.values.keys()].filter((key) => key.startsWith(prefix));
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function writePluginLock(
  dir: string,
  plugins: Record<string, string>,
): Promise<void> {
  await writeFile(join(dir, "plugins.lock"), JSON.stringify({ plugins }));
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

describe("startupPlugins external plugin loading", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("fails startup by default when an external plugin fails to load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const pluginDir = await mkdtemp(join(tmpdir(), "nexus-form-plugin-"));
    const pluginSource = "export default {";
    await writeFile(join(pluginDir, "broken.mjs"), pluginSource);
    await writePluginLock(pluginDir, {
      "broken.mjs": sha256(pluginSource),
    });
    const registry = new ValidationProviderRegistry();

    await expect(
      startupPlugins(registry, {
        pluginsDirs: [pluginDir],
        logPrefix: "api",
      }),
    ).rejects.toThrow("Failed to load validation plugins");
    expect(registry.getNames()).toEqual([]);
  });

  it("continues after external plugin load failures when explicitly configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pluginDir = await mkdtemp(join(tmpdir(), "nexus-form-plugin-"));
    const pluginSource = "export default {";
    await writeFile(join(pluginDir, "broken.mjs"), pluginSource);
    await writePluginLock(pluginDir, {
      "broken.mjs": sha256(pluginSource),
    });
    const registry = new ValidationProviderRegistry();

    await startupPlugins(registry, {
      pluginsDirs: [pluginDir],
      logPrefix: "api",
      failOnExternalPluginError: false,
    });

    expect(registry.getNames()).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Continuing after validation plugin load failures",
      ),
    );
  });

  it("fails startup by default when an external plugin cannot be registered", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pluginDir = await mkdtemp(join(tmpdir(), "nexus-form-plugin-"));
    const pluginSource = `
const passthroughSchema = {
  parse: (value) => value,
  safeParse: (value) => ({ success: true, data: value }),
};

export default {
  name: "external_provider",
  label: "External Provider",
  description: "External provider",
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
    await writeFile(join(pluginDir, "external.mjs"), pluginSource);
    await writePluginLock(pluginDir, {
      "external.mjs": sha256(pluginSource),
    });
    const registry = new ValidationProviderRegistry();
    vi.spyOn(registry, "register").mockImplementation(() => {
      throw new Error("registry unavailable");
    });

    await expect(
      startupPlugins(registry, {
        pluginsDirs: [pluginDir],
        logPrefix: "api",
      }),
    ).rejects.toThrow("[api] Failed to register external plugin");
    expect(registry.getNames()).toEqual([]);
  });
});

describe("startupPlugins plugin drift guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("records the current runtime manifest when no peer instance is present", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();

    await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
        ttlSeconds: 60,
      },
    });

    const rawManifest = store.values.get("test:plugins:api:api-1");
    expect(rawManifest).toBeDefined();
    expect(JSON.parse(rawManifest ?? "{}")).toMatchObject({
      role: "api",
      providers: ["discord"],
      pluginHashes: [],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("could not find any worker manifest"),
    );
  });

  it("deletes its own manifest key on graceful stop so a replacement instance never sees it", async () => {
    // Without this, a retired instance's manifest would linger for the full
    // TTL and could fail a freshly-started replacement's initial (no grace
    // period) startup check even though the retired instance is gone.
    vi.useFakeTimers();
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();

    const handle = await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
        refreshIntervalMs: 10,
      },
    });

    expect(store.values.has("test:plugins:api:api-1")).toBe(true);
    expect(handle).toBeDefined();
    if (!handle) throw new Error("plugin drift guard handle missing");
    await handle.stop();

    expect(store.values.has("test:plugins:api:api-1")).toBe(false);
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
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
        ttlSeconds: 1800,
        refreshIntervalMs: 10,
        failOnMismatch: false,
      },
    });

    store.values.set(
      "test:plugins:worker:worker-1",
      JSON.stringify(makeManifest("worker", ["github"])),
    );
    await vi.advanceTimersByTimeAsync(10);

    expect(
      store.setCalls.filter((call) => call.key === "test:plugins:api:api-1"),
    ).toHaveLength(2);
    expect(store.setCalls.at(-1)?.ttlSeconds).toBe(1800);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Plugin drift detected"),
    );

    expect(handle).toBeDefined();
    if (!handle) throw new Error("plugin drift guard handle missing");
    await handle.stop();
  });

  it("treats periodic drift as fatal immediately when the grace period is disabled", async () => {
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
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
        refreshIntervalMs: 10,
        mismatchGracePeriodMs: 0,
      },
    });

    store.values.set(
      "test:plugins:worker:worker-1",
      JSON.stringify(makeManifest("worker", ["github"])),
    );
    await vi.advanceTimersByTimeAsync(10);

    expect(queueMicrotaskSpy).toHaveBeenCalledWith(expect.any(Function));
    expect(store.values.has("test:plugins:api:api-1")).toBe(true);
    expect(handle).toBeDefined();
    if (!handle) throw new Error("plugin drift guard handle missing");
    await handle.stop();
  });

  it("tolerates periodic drift during the grace period, then escalates once it elapses", async () => {
    vi.useFakeTimers();
    const queueMicrotaskSpy = vi.fn();
    vi.stubGlobal("queueMicrotask", queueMicrotaskSpy);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();

    const handle = await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
        refreshIntervalMs: 10,
        mismatchGracePeriodMs: 10,
      },
    });

    store.values.set(
      "test:plugins:worker:worker-1",
      JSON.stringify(makeManifest("worker", ["github"])),
    );

    // First mismatch: still within the grace period, so no escalation yet.
    await vi.advanceTimersByTimeAsync(10);
    expect(queueMicrotaskSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("tolerating during grace period"),
      expect.any(Error),
    );

    // Mismatch has now persisted past the grace period: escalate and crash.
    await vi.advanceTimersByTimeAsync(10);
    expect(queueMicrotaskSpy).toHaveBeenCalledWith(expect.any(Function));

    expect(handle).toBeDefined();
    if (!handle) throw new Error("plugin drift guard handle missing");
    await handle.stop();
  });

  it("resets the grace period once the peer manifest matches again", async () => {
    vi.useFakeTimers();
    const queueMicrotaskSpy = vi.fn();
    vi.stubGlobal("queueMicrotask", queueMicrotaskSpy);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();

    const handle = await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
        refreshIntervalMs: 10,
        mismatchGracePeriodMs: 10,
      },
    });

    store.values.set(
      "test:plugins:worker:worker-1",
      JSON.stringify(makeManifest("worker", ["github"])),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(queueMicrotaskSpy).not.toHaveBeenCalled();

    // The worker catches up (e.g. its own rollout completes) before the
    // grace period elapses: the mismatch clock must reset, not accumulate.
    store.values.set(
      "test:plugins:worker:worker-1",
      JSON.stringify(makeManifest("worker", ["discord"])),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(queueMicrotaskSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("recovered after a transient mismatch"),
    );

    store.values.set(
      "test:plugins:worker:worker-1",
      JSON.stringify(makeManifest("worker", ["github"])),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(queueMicrotaskSpy).not.toHaveBeenCalled();

    expect(handle).toBeDefined();
    if (!handle) throw new Error("plugin drift guard handle missing");
    await handle.stop();
  });

  it("does not escalate an in-flight periodic failure after stop", async () => {
    vi.useFakeTimers();
    const queueMicrotaskSpy = vi.fn();
    vi.stubGlobal("queueMicrotask", queueMicrotaskSpy);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.keys = async () => ["test:plugins:worker:worker-1"];
    const peerRead = createDeferred<string | null>();
    let readCount = 0;
    store.get = async (key: string): Promise<string | null> => {
      readCount += 1;
      if (readCount === 1) return null;
      expect(key).toBe("test:plugins:worker:worker-1");
      return peerRead.promise;
    };

    const handle = await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
        refreshIntervalMs: 10,
      },
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(handle).toBeDefined();
    if (!handle) throw new Error("plugin drift guard handle missing");
    const stopped = handle.stop();
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

  it("does not reset the grace period when the peer manifest merely goes missing", async () => {
    vi.useFakeTimers();
    const queueMicrotaskSpy = vi.fn();
    vi.stubGlobal("queueMicrotask", queueMicrotaskSpy);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();

    const handle = await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
        refreshIntervalMs: 10,
        mismatchGracePeriodMs: 15,
      },
    });

    // Tick 1: peer is present but mismatched. Grace clock starts.
    store.values.set(
      "test:plugins:worker:worker-1",
      JSON.stringify(makeManifest("worker", ["github"])),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(queueMicrotaskSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("tolerating during grace period"),
      expect.any(Error),
    );

    // Tick 2: the peer manifest key vanishes (e.g. TTL expiry or a peer
    // restart mid-rollout). This must NOT be treated as recovery, or the
    // grace clock would reset and a genuinely stuck mismatch could persist
    // forever by flapping between "mismatched" and "peer absent".
    store.values.delete("test:plugins:worker:worker-1");
    await vi.advanceTimersByTimeAsync(10);
    expect(queueMicrotaskSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("recovered after a transient mismatch"),
    );

    // Tick 3: the peer reappears, still mismatched. Total elapsed since the
    // original tick-1 mismatch now exceeds the grace period, so this must
    // escalate — proving the clock was preserved across the "pending" tick
    // rather than restarted.
    store.values.set(
      "test:plugins:worker:worker-1",
      JSON.stringify(makeManifest("worker", ["github"])),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(queueMicrotaskSpy).toHaveBeenCalledWith(expect.any(Function));

    expect(handle).toBeDefined();
    if (!handle) throw new Error("plugin drift guard handle missing");
    await handle.stop();
  });

  it("passes startup when the peer manifest matches providers and plugin hashes", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.values.set(
      "test:plugins:worker:worker-1",
      JSON.stringify(makeManifest("worker", ["discord"])),
    );

    await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
      },
    });

    expect(store.values.has("test:plugins:api:api-1")).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Plugin drift guard matched all 1 worker instance(s)",
      ),
    );
  });

  it("detects drift even when only one of several peer instances mismatches", async () => {
    // Reproduces the real topology: several independently deployed worker
    // Deployments (discord/github/twitter/sheets/notifications/vrchat) each
    // publish their own manifest. If even one instance is out of sync with
    // the current process, the guard must not let a matching sibling
    // instance mask it.
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.values.set(
      "test:plugins:worker:worker-rolled",
      JSON.stringify(makeManifest("worker", ["discord"])),
    );
    store.values.set(
      "test:plugins:worker:worker-not-yet-rolled",
      JSON.stringify(makeManifest("worker", ["github"])),
    );

    await expect(
      startupPlugins(registry, {
        logPrefix: "api",
        pluginDriftGuard: {
          role: "api",
          instanceId: "api-1",
          store,
          keyPrefix: "test:plugins",
        },
      }),
    ).rejects.toThrow("Plugin drift detected");
  });

  it("treats all-expired peer keys as pending rather than a confirmed match", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.keys = async () => ["test:plugins:worker:worker-1"];
    store.get = async () => null; // expired between keys() and get()

    await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
      },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("could not resolve any worker manifest"),
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
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
      },
    });

    const rawManifest = store.values.get("test:plugins:api:api-1");
    expect(JSON.parse(rawManifest ?? "{}")).toMatchObject({
      providers: ["builtin_discord"],
      pluginHashes: [expectedHash],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("could not find any worker manifest"),
    );
  });

  it("fails startup when the peer manifest has different providers", async () => {
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.values.set(
      "test:plugins:worker:worker-1",
      JSON.stringify(makeManifest("worker", ["github"])),
    );

    await expect(
      startupPlugins(registry, {
        logPrefix: "api",
        pluginDriftGuard: {
          role: "api",
          instanceId: "api-1",
          store,
          keyPrefix: "test:plugins",
        },
      }),
    ).rejects.toThrow("Plugin drift detected");
    expect(store.values.has("test:plugins:api:api-1")).toBe(false);
  });

  it("fails startup when the peer manifest has different plugin hashes", async () => {
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.values.set(
      "test:plugins:worker:worker-1",
      JSON.stringify(makeManifest("worker", ["discord"], ["hash-a"])),
    );

    await expect(
      startupPlugins(registry, {
        logPrefix: "api",
        pluginDriftGuard: {
          role: "api",
          instanceId: "api-1",
          store,
          keyPrefix: "test:plugins",
        },
      }),
    ).rejects.toThrow("pluginHashes");
    expect(store.values.has("test:plugins:api:api-1")).toBe(false);
  });

  it("fails startup when the peer manifest role does not match the key", async () => {
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.values.set(
      "test:plugins:worker:worker-1",
      JSON.stringify(makeManifest("api", ["discord"])),
    );

    await expect(
      startupPlugins(registry, {
        logPrefix: "api",
        pluginDriftGuard: {
          role: "api",
          instanceId: "api-1",
          store,
          keyPrefix: "test:plugins",
        },
      }),
    ).rejects.toThrow("expected worker manifest");
    expect(store.values.has("test:plugins:api:api-1")).toBe(false);
  });

  it.each([
    {
      label: "non-JSON peer manifest",
      peerManifest: "not-json",
      error: "invalid worker manifest(s)",
    },
    {
      label: "invalid peer manifest",
      peerManifest: JSON.stringify({
        version: 1,
        role: "worker",
        providers: ["discord"],
      }),
      error: "invalid worker manifest(s)",
    },
  ])("cleans up current manifest after $label", async ({
    peerManifest,
    error,
  }) => {
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.values.set("test:plugins:worker:worker-1", peerManifest);

    await expect(
      startupPlugins(registry, {
        logPrefix: "api",
        pluginDriftGuard: {
          role: "api",
          instanceId: "api-1",
          store,
          keyPrefix: "test:plugins",
        },
      }),
    ).rejects.toThrow(error);
    expect(store.values.has("test:plugins:api:api-1")).toBe(false);
  });

  it.each([
    {
      label: "non-JSON peer manifest",
      peerManifest: "not-json",
      warning: "invalid worker manifest(s)",
    },
    {
      label: "invalid peer manifest",
      peerManifest: JSON.stringify({
        version: 1,
        role: "worker",
        providers: ["discord"],
      }),
      warning: "invalid worker manifest(s)",
    },
    {
      label: "wrong peer role",
      peerManifest: JSON.stringify(makeManifest("api", ["discord"])),
      warning: "invalid worker manifest(s)",
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
    store.values.set("test:plugins:worker:worker-1", peerManifest);

    await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
        failOnMismatch: false,
      },
    });

    expect(store.values.has("test:plugins:api:api-1")).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(warning));
  });

  it("warns and continues when peer manifest read fails with failOnMismatch=false", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry = new ValidationProviderRegistry();
    registry.register(makeProvider("discord"));
    const store = new MemoryDriftStore();
    store.keys = async () => {
      throw new Error("Redis unavailable");
    };

    await startupPlugins(registry, {
      logPrefix: "api",
      pluginDriftGuard: {
        role: "api",
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
        failOnMismatch: false,
      },
    });

    expect(store.values.has("test:plugins:api:api-1")).toBe(true);
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
        instanceId: "api-1",
        store,
        keyPrefix: "test:plugins",
        failOnMismatch: false,
      },
    });

    expect(store.values.has("test:plugins:api:api-1")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("warning-only check failed"),
      expect.any(Error),
    );
  });
});
