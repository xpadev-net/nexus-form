/**
 * Built-in validation provider plugin specifiers loaded during startup.
 */
export const BUILTIN_VALIDATION_PLUGIN_SPECIFIERS = [
  "@nexus-form/validation-provider-discord/plugin",
  "@nexus-form/validation-provider-github/plugin",
  "@nexus-form/validation-provider-twitter/plugin",
] as const;

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
