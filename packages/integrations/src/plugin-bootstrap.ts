import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * Built-in validation provider plugin specifiers loaded during startup.
 */
export const BUILTIN_VALIDATION_PLUGIN_SPECIFIERS = [
  "@nexus-form/validation-provider-discord/plugin",
  "@nexus-form/validation-provider-github/plugin",
  "@nexus-form/validation-provider-twitter/plugin",
] as const;

/**
 * Resolves a built-in plugin specifier to an absolute file path that is
 * consistent across all runtimes (plain Node.js and tsx).
 *
 * tsx's ESM loader hook may map `import.meta.resolve()` results from .mjs
 * to .ts or even to source files under `src/`, producing a path that differs
 * from what plain Node.js returns.  This function bypasses the ESM loader by
 * using CJS module resolution (`createRequire`) to find the package root,
 * then resolves the target file via the package's `exports` map directly.
 */
export function resolveBuiltinPluginSpecifier(specifier: string): string {
  const parts = specifier.split("/");
  const pkgName = specifier.startsWith("@")
    ? `${parts[0]}/${parts[1]}`
    : parts[0];
  const subpath =
    "/" +
    (specifier.startsWith("@")
      ? parts.slice(2).join("/")
      : parts.slice(1).join("/"));

  const require = createRequire(import.meta.url);
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  const pkgRoot = dirname(pkgJsonPath);

  const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
    exports?: Record<string, { import?: string; default?: string }>;
  };
  const exportTarget =
    pkg.exports?.[subpath]?.import ?? pkg.exports?.[subpath]?.default;
  if (!exportTarget) {
    throw new Error(
      `[resolveBuiltinPluginSpecifier] No export found for ${subpath} in ${pkgName}`,
    );
  }

  return resolve(pkgRoot, exportTarget);
}

/**
 * Default filesystem directory for bundled external validation plugins.
 */
export const DEFAULT_VALIDATION_PLUGINS_DIR = "/app/plugins/validation";

/**
 * Resolve the validation plugin directory.
 *
 * @param env - Optional environment-like object containing VALIDATION_PLUGINS_DIR.
 * @returns The directory from env, process.env, or the default path, in that order.
 */
export function getValidationPluginsDir(env?: {
  VALIDATION_PLUGINS_DIR?: string;
}): string {
  return (
    env?.VALIDATION_PLUGINS_DIR ||
    process.env.VALIDATION_PLUGINS_DIR ||
    DEFAULT_VALIDATION_PLUGINS_DIR
  );
}
