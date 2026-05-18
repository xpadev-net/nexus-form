import { z } from "zod";
import type { ValidationProvider } from "./plugin-interface";
import { loadPluginFromSpecifier, PluginLoader } from "./plugin-loader";
import type { ValidationProviderRegistry } from "./provider-registry";

const PLUGIN_DRIFT_KEY_PREFIX = "nexus-form:validation-plugin-manifest";
const PLUGIN_DRIFT_TTL_SECONDS = 300;

const pluginRuntimeRoleSchema = z.enum(["api", "worker"]);
const pluginManifestSchema = z
  .object({
    version: z.literal(1),
    role: pluginRuntimeRoleSchema,
    providers: z.array(z.string()).readonly(),
    pluginHashes: z.array(z.string()).readonly(),
  })
  .strict();

export type PluginRuntimeRole = z.infer<typeof pluginRuntimeRoleSchema>;
export type PluginRuntimeManifest = z.infer<typeof pluginManifestSchema>;

export interface PluginDriftStore {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface PluginDriftGuardOptions {
  role: PluginRuntimeRole;
  store: PluginDriftStore;
  keyPrefix?: string;
  ttlSeconds?: number;
  failOnMismatch?: boolean;
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
): Promise<void> {
  const keyPrefix = guard.keyPrefix ?? PLUGIN_DRIFT_KEY_PREFIX;
  const ttlSeconds = guard.ttlSeconds ?? PLUGIN_DRIFT_TTL_SECONDS;
  const current = buildManifest(guard.role, registry, pluginHashes);
  const peerRole = guard.role === "api" ? "worker" : "api";
  const currentKey = `${keyPrefix}:${guard.role}`;
  const peerKey = `${keyPrefix}:${peerRole}`;

  await guard.store.set(currentKey, JSON.stringify(current), "EX", ttlSeconds);

  try {
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
    try {
      await guard.store.del(currentKey);
    } catch (cleanupError) {
      console.warn(
        `[${logPrefix}] Plugin drift guard failed to delete ${guard.role} manifest after startup failure:`,
        cleanupError,
      );
    }
    throw error;
  }
}

function registerOrOverride(
  registry: ValidationProviderRegistry,
  provider: ValidationProvider,
  source: string,
  logPrefix: string,
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
  }
}

export async function startupPlugins(
  registry: ValidationProviderRegistry,
  {
    builtinPlugins = [],
    pluginsDirs = [],
    logPrefix,
    pluginDriftGuard,
  }: StartupPluginsOptions,
): Promise<void> {
  const pluginHashes: string[] = [];

  for (const specifier of builtinPlugins) {
    const outcome = await loadPluginFromSpecifier(specifier);
    if (outcome.kind === "ok") {
      registerOrOverride(registry, outcome.provider, specifier, logPrefix);
    } else if (outcome.kind === "skipped") {
      console.warn(`[${logPrefix}] ${outcome.reason} in: ${specifier}`);
    } else {
      console.error(
        `[${logPrefix}] Failed to load built-in plugin ${specifier}: ${outcome.error}`,
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
      console.warn(`[${logPrefix}] Failed to load plugins from ${dir}:`, error);
      continue;
    }

    for (const plugin of plugins) {
      registerOrOverride(registry, plugin, dir, logPrefix);
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
  }
}
