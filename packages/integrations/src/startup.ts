import type { ValidationProvider } from "./plugin-interface";
import { loadPluginFromSpecifier, PluginLoader } from "./plugin-loader";
import type { ValidationProviderRegistry } from "./provider-registry";

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
  { builtinPlugins = [], pluginsDirs = [], logPrefix }: StartupPluginsOptions,
): Promise<void> {
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
  }

  console.log(`[${logPrefix}] Registered providers:`, registry.getNames());
}
