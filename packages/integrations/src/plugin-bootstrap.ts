import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
 * from what plain Node.js returns.  This function resolves the package
 * entry point (the `.` export, which IS defined in the exports map), then
 * walks up the directory tree to find `package.json` and reads the exports
 * map to resolve the target file from there.
 */
export function resolveBuiltinPluginSpecifier(specifier: string): string {
  const parts = specifier.split("/");
  const pkgName = specifier.startsWith("@")
    ? `${parts[0]}/${parts[1]!}`
    : parts[0]!;
  const rawSubpath = specifier.startsWith("@")
    ? parts.slice(2).join("/")
    : parts.slice(1).join("/");
  const subpath = rawSubpath ? `./${rawSubpath}` : ".";

  const entryUrl = import.meta.resolve(pkgName);
  const entryPath = fileURLToPath(entryUrl);

  let pkgRoot = dirname(entryPath);
  let pkg: Record<string, unknown> | undefined;
  for (;;) {
    const candidate = join(pkgRoot, "package.json");
    if (existsSync(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as Record<
        string,
        unknown
      >;
      if (parsed.name) {
        pkg = parsed;
        break;
      }
    }
    const parent = dirname(pkgRoot);
    if (parent === pkgRoot) {
      throw new Error(
        `[resolveBuiltinPluginSpecifier] Cannot find package.json with name for ${pkgName} (resolved: ${entryPath})`,
      );
    }
    pkgRoot = parent;
  }
  const subpathExport = (pkg as Record<string, unknown>).exports as
    | Record<string, unknown>
    | undefined;
  const subpathValue =
    subpathExport !== undefined
      ? (subpathExport as Record<string, unknown>)[subpath]
      : undefined;
  const exportTarget: string | undefined =
    typeof subpathValue === "string"
      ? subpathValue
      : ((subpathValue as { import?: string } | undefined)?.import ??
        (subpathValue as { default?: string } | undefined)?.default);
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
