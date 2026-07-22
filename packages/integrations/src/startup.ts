import { basename, dirname, extname, join } from "node:path";
import { z } from "zod";
import type { ValidationProvider } from "./plugin-interface";
import { loadPluginFromFile, PluginLoader } from "./plugin-loader";
import type { ValidationProviderRegistry } from "./provider-registry";

const PLUGIN_DRIFT_KEY_PREFIX = "nexus-form:validation-plugin-manifest";
const PLUGIN_DRIFT_TTL_SECONDS = 1800;
const PLUGIN_DRIFT_REFRESH_INTERVAL_MS = 60_000;
const PLUGIN_DRIFT_MISMATCH_GRACE_MS = 5 * 60_000;

const pluginRuntimeRoleSchema = z.enum(["api", "worker"]);
const pluginManifestSchema = z
  .object({
    version: z.literal(1),
    role: pluginRuntimeRoleSchema,
    providers: z.array(z.string()).readonly(),
    pluginHashes: z.array(z.string()).readonly(),
  })
  .strict();

/**
 * Runtime identity used by the plugin drift guard. Only the API process and
 * Worker process publish manifests, and each compares itself against the other
 * role.
 */
export type PluginRuntimeRole = z.infer<typeof pluginRuntimeRoleSchema>;

/**
 * Versioned manifest describing the validation plugins loaded by one runtime.
 * `providers` and `pluginHashes` are sorted, de-duplicated snapshots so API and
 * Worker manifests can be compared deterministically.
 */
export type PluginRuntimeManifest = z.infer<typeof pluginManifestSchema>;

/**
 * Minimal Redis-like store used by the plugin drift guard.
 */
export interface PluginDriftStore {
  /**
   * Reads a manifest value by key, returning `null` when the key is absent.
   */
  get(key: string): Promise<string | null>;
  /**
   * Stores a manifest value with Redis `EX` expiration semantics.
   *
   * @param key Manifest key to write.
   * @param value Serialized manifest JSON.
   * @param mode Expiration mode; currently only `EX` is supported.
   * @param ttlSeconds Expiration time in seconds.
   */
  set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
  ): Promise<unknown>;
  /**
   * Deletes a manifest key. The return value is store-specific and ignored.
   */
  del(key: string): Promise<unknown>;
}

/**
 * Options for publishing and comparing API/Worker plugin manifests.
 */
export interface PluginDriftGuardOptions {
  /**
   * Current runtime role; determines both the current manifest key and peer key.
   */
  role: PluginRuntimeRole;
  /**
   * Required Redis-like store used for manifest exchange.
   */
  store: PluginDriftStore;
  /**
   * Optional Redis key prefix. Defaults to
   * `nexus-form:validation-plugin-manifest`.
   */
  keyPrefix?: string;
  /**
   * Optional manifest TTL in seconds. Defaults to 1800 seconds.
   */
  ttlSeconds?: number;
  /**
   * Optional interval for refreshing the current manifest and comparing it
   * with the peer runtime. Defaults to 60 seconds. Set to 0 to disable the
   * periodic guard after the startup check.
   */
  refreshIntervalMs?: number;
  /**
   * When true or omitted, drift and store errors fail startup. When false, the
   * guard logs warnings and lets startup continue.
   */
  failOnMismatch?: boolean;
  /**
   * How long a periodic (post-startup) mismatch may persist before the guard
   * escalates from a warning-only tolerance to the fatal `failOnMismatch`
   * behavior. Independent Kubernetes Deployments (e.g. API vs Worker, or
   * several Worker Deployments) roll out on their own schedules, so a brief
   * manifest mismatch while one side is mid-rollout is expected, not an
   * incident. Only applies to the periodic recheck; the initial startup
   * check still fails fast so a newly-starting pod never claims readiness
   * while already mismatched. Defaults to 5 minutes. Set to 0 to escalate on
   * the very first periodic mismatch, matching pre-grace-period behavior.
   */
  mismatchGracePeriodMs?: number;
}

export interface PluginDriftGuardHandle {
  stop(): Promise<void>;
}

/**
 * Normalize built-in plugin file paths between TS source and packaged MJS artifacts.
 *
 * In local tsx execution, `import.meta.resolve()` can return source paths like
 * `.../<package>/src/<file>.ts`. In production/runtime execution, paths are
 * already in `dist` and should remain unchanged. This helper rewrites only the
 * final `src` directory segment before replacing TS extensions with `.mjs`.
 */
export function normalizeBuiltinPluginPath(resolvedPath: string): string {
  if (!/\.(?:m|c)?ts$/.test(extname(resolvedPath))) {
    return resolvedPath;
  }

  const pluginDir = dirname(resolvedPath);
  if (basename(pluginDir) !== "src") {
    return resolvedPath;
  }

  return join(dirname(pluginDir), "dist", basename(resolvedPath)).replace(
    /\.(?:m|c)?ts$/,
    ".mjs",
  );
}

export interface StartupPluginsOptions {
  /**
   * Module specifiers (file paths or `file://` URLs) of bundled built-in
   * plugins. Loaded before {@link pluginsDirs}, so user-supplied plugins with
   * the same `name` will override them.
   */
  builtinPlugins?: string[];
  /**
   * Directories whose `.js` / `.mjs` files implement the
   * {@link ValidationProvider} interface. Scanned in order; later directories
   * may override earlier registrations.
   */
  pluginsDirs?: string[];
  /**
   * Identifier for log lines (e.g. "api", "worker").
   */
  logPrefix: string;
  /**
   * Optional runtime guard that records the loaded plugin manifest and compares
   * it with the opposite runtime to detect API/Worker plugin drift.
   */
  pluginDriftGuard?: PluginDriftGuardOptions;
  /**
   * When true or omitted, external plugin load and registration failures fail
   * startup. Set to false only for an explicit degraded startup mode.
   */
  failOnExternalPluginError?: boolean;
}

function buildManifest(
  role: PluginRuntimeRole,
  registry: ValidationProviderRegistry,
  pluginHashes: string[],
): PluginRuntimeManifest {
  return {
    version: 1,
    role,
    providers: [...registry.getNames()].sort(),
    pluginHashes: [...new Set(pluginHashes)].sort(),
  };
}

function diffLists(
  label: string,
  left: readonly string[],
  right: readonly string[],
): string | null {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const onlyLeft = left.filter((value) => !rightSet.has(value));
  const onlyRight = right.filter((value) => !leftSet.has(value));
  if (onlyLeft.length === 0 && onlyRight.length === 0) return null;
  return `${label}: only-current=[${onlyLeft.join(", ")}] only-peer=[${onlyRight.join(", ")}]`;
}

function compareManifests(
  current: PluginRuntimeManifest,
  peer: PluginRuntimeManifest,
): string[] {
  const differences = [
    diffLists("providers", current.providers, peer.providers),
    diffLists("pluginHashes", current.pluginHashes, peer.pluginHashes),
  ].filter((value): value is string => value !== null);
  return differences;
}

async function publishAndAssertPluginManifest(
  registry: ValidationProviderRegistry,
  pluginHashes: string[],
  guard: PluginDriftGuardOptions,
  logPrefix: string,
  deleteCurrentManifestOnError = true,
): Promise<void> {
  const keyPrefix = guard.keyPrefix ?? PLUGIN_DRIFT_KEY_PREFIX;
  const ttlSeconds = guard.ttlSeconds ?? PLUGIN_DRIFT_TTL_SECONDS;
  const current = buildManifest(guard.role, registry, pluginHashes);
  const peerRole = guard.role === "api" ? "worker" : "api";
  const currentKey = `${keyPrefix}:${guard.role}`;
  const peerKey = `${keyPrefix}:${peerRole}`;

  try {
    await guard.store.set(
      currentKey,
      JSON.stringify(current),
      "EX",
      ttlSeconds,
    );

    const peerRaw = await guard.store.get(peerKey);
    if (!peerRaw) {
      console.warn(
        `[${logPrefix}] Plugin drift guard could not find ${peerRole} manifest; comparison will run when both runtimes have started.`,
      );
      return;
    }

    let peerJson: unknown;
    try {
      peerJson = JSON.parse(peerRaw);
    } catch {
      const message = `Plugin drift guard found non-JSON ${peerRole} manifest`;
      if (guard.failOnMismatch ?? true) throw new Error(message);
      console.warn(`[${logPrefix}] ${message}`);
      return;
    }

    const peerParse = pluginManifestSchema.safeParse(peerJson);
    if (!peerParse.success) {
      const message = `Plugin drift guard found invalid ${peerRole} manifest`;
      if (guard.failOnMismatch ?? true) throw new Error(message);
      console.warn(`[${logPrefix}] ${message}`);
      return;
    }
    if (peerParse.data.role !== peerRole) {
      const message = `Plugin drift guard expected ${peerRole} manifest but found ${peerParse.data.role}`;
      if (guard.failOnMismatch ?? true) throw new Error(message);
      console.warn(`[${logPrefix}] ${message}`);
      return;
    }

    const differences = compareManifests(current, peerParse.data);
    if (differences.length === 0) {
      console.log(`[${logPrefix}] Plugin drift guard matched ${peerRole}`);
      return;
    }

    const message = `Plugin drift detected between ${guard.role} and ${peerRole}: ${differences.join("; ")}`;
    if (guard.failOnMismatch ?? true) {
      throw new Error(message);
    }
    console.warn(`[${logPrefix}] ${message}`);
  } catch (error) {
    if (guard.failOnMismatch ?? true) {
      if (deleteCurrentManifestOnError) {
        try {
          await guard.store.del(currentKey);
        } catch (cleanupError) {
          console.warn(
            `[${logPrefix}] Plugin drift guard failed to delete ${guard.role} manifest after startup failure:`,
            cleanupError,
          );
        }
      }
      throw error;
    }
    console.warn(
      `[${logPrefix}] Plugin drift guard warning-only check failed:`,
      error,
    );
  }
}

function startPluginDriftGuardRefresh(
  registry: ValidationProviderRegistry,
  pluginHashes: string[],
  guard: PluginDriftGuardOptions,
  logPrefix: string,
): PluginDriftGuardHandle | undefined {
  const refreshIntervalMs =
    guard.refreshIntervalMs ?? PLUGIN_DRIFT_REFRESH_INTERVAL_MS;
  if (refreshIntervalMs <= 0) return undefined;

  const gracePeriodMs =
    guard.mismatchGracePeriodMs ?? PLUGIN_DRIFT_MISMATCH_GRACE_MS;

  let stopped = false;
  let running = false;
  let activeCheck: Promise<void> | null = null;
  let mismatchSince: number | null = null;
  const timer = setInterval(() => {
    if (running || stopped) return;
    running = true;
    activeCheck = publishAndAssertPluginManifest(
      registry,
      pluginHashes,
      guard,
      logPrefix,
      false,
    )
      .then(() => {
        if (mismatchSince !== null) {
          console.log(
            `[${logPrefix}] Plugin drift guard recovered after a transient mismatch`,
          );
        }
        mismatchSince = null;
      })
      .catch((error: unknown) => {
        if (stopped) {
          console.warn(
            `[${logPrefix}] Plugin drift guard periodic check stopped after an in-flight error:`,
            error,
          );
          return;
        }
        if (!(guard.failOnMismatch ?? true)) {
          console.warn(
            `[${logPrefix}] Plugin drift guard periodic warning-only check failed:`,
            error,
          );
          return;
        }

        const now = Date.now();
        if (mismatchSince === null) mismatchSince = now;
        const elapsedMs = now - mismatchSince;
        if (elapsedMs < gracePeriodMs) {
          console.warn(
            `[${logPrefix}] Plugin drift guard periodic check failed; tolerating during grace period (${Math.round(elapsedMs / 1000)}s/${Math.round(gracePeriodMs / 1000)}s elapsed, likely a rolling deploy in progress):`,
            error,
          );
          return;
        }

        stopped = true;
        clearInterval(timer);
        console.error(
          `[${logPrefix}] Plugin drift guard periodic check failed past the ${Math.round(gracePeriodMs / 1000)}s grace period:`,
          error,
        );
        queueMicrotask(() => {
          throw error;
        });
      })
      .finally(() => {
        running = false;
        activeCheck = null;
      });
  }, refreshIntervalMs);
  timer.unref?.();

  return {
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await activeCheck;
    },
  };
}

function registerOrOverride(
  registry: ValidationProviderRegistry,
  provider: ValidationProvider,
  source: string,
  logPrefix: string,
  failOnError = false,
  failureLabel = "plugin",
): void {
  if (registry.has(provider.name)) {
    console.warn(
      `[${logPrefix}] Plugin "${provider.name}" from ${source} overrides an earlier registration. Ensure this is intentional.`,
    );
    registry.unregister(provider.name);
  }
  try {
    registry.register(provider);
    console.log(
      `[${logPrefix}] Loaded validation provider: ${provider.name} (${provider.label})`,
    );
  } catch (error) {
    console.error(
      `[${logPrefix}] Failed to register provider ${provider.name}:`,
      error,
    );
    if (failOnError) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `[${logPrefix}] Failed to register ${failureLabel} ${source}: ${message}`,
        { cause: error },
      );
    }
  }
}

function summarizeFailedPlugins(
  failedPlugins: Array<{ file: string; error: string }>,
): string {
  return failedPlugins.map(({ file, error }) => `${file}: ${error}`).join("; ");
}

export async function startupPlugins(
  registry: ValidationProviderRegistry,
  {
    builtinPlugins = [],
    pluginsDirs = [],
    logPrefix,
    pluginDriftGuard,
    failOnExternalPluginError = true,
  }: StartupPluginsOptions,
): Promise<PluginDriftGuardHandle | undefined> {
  const pluginHashes: string[] = [];

  for (const specifier of builtinPlugins) {
    // loadPluginFromFile adds the content hash to the file URL query so Node's
    // module cache cannot hide same-path plugin changes between deployments.
    const outcome = await loadPluginFromFile(specifier);
    if (outcome.kind === "ok") {
      registerOrOverride(
        registry,
        outcome.provider,
        specifier,
        logPrefix,
        true,
        "built-in plugin",
      );
      pluginHashes.push(outcome.hash);
    } else if (outcome.kind === "skipped") {
      throw new Error(
        `[${logPrefix}] Built-in plugin ${specifier} was skipped: ${outcome.reason} sha256=${outcome.hash}`,
      );
    } else {
      const hashSuffix = outcome.hash ? ` sha256=${outcome.hash}` : "";
      throw new Error(
        `[${logPrefix}] Failed to load built-in plugin ${specifier}: ${outcome.error}${hashSuffix}`,
      );
    }
  }

  for (const dir of pluginsDirs) {
    console.log(`[${logPrefix}] Loading validation plugins from: ${dir}`);
    const loader = new PluginLoader(dir);
    let plugins: ValidationProvider[] = [];
    try {
      plugins = await loader.loadPlugins();
    } catch (error) {
      if (failOnExternalPluginError) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `[${logPrefix}] Failed to load validation plugins from ${dir}: ${message}`,
          { cause: error },
        );
      }
      console.warn(`[${logPrefix}] Failed to load plugins from ${dir}:`, error);
      continue;
    }
    if (loader.hasFailedPlugins()) {
      const failedPlugins = loader.getFailedPlugins();
      const message = summarizeFailedPlugins(failedPlugins);
      if (failOnExternalPluginError) {
        throw new Error(
          `[${logPrefix}] Failed to load validation plugins from ${dir}: ${message}`,
          { cause: failedPlugins },
        );
      }
      console.warn(
        `[${logPrefix}] Continuing after validation plugin load failures from ${dir}: ${message}`,
      );
    }

    for (const plugin of plugins) {
      registerOrOverride(
        registry,
        plugin,
        dir,
        logPrefix,
        failOnExternalPluginError,
        "external plugin",
      );
    }
    pluginHashes.push(...loader.getLoadedPluginHashes());
  }

  console.log(`[${logPrefix}] Registered providers:`, registry.getNames());

  if (pluginDriftGuard) {
    await publishAndAssertPluginManifest(
      registry,
      pluginHashes,
      pluginDriftGuard,
      logPrefix,
    );
    return startPluginDriftGuardRefresh(
      registry,
      pluginHashes,
      pluginDriftGuard,
      logPrefix,
    );
  }

  return undefined;
}
