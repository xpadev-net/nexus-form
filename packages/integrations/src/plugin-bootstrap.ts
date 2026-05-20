export const BUILTIN_VALIDATION_PLUGIN_SPECIFIERS = [
  "@nexus-form/validation-provider-discord/plugin",
  "@nexus-form/validation-provider-github/plugin",
  "@nexus-form/validation-provider-twitter/plugin",
] as const;

export const DEFAULT_VALIDATION_PLUGINS_DIR = "/app/plugins/validation";

export function getValidationPluginsDir(env?: {
  VALIDATION_PLUGINS_DIR?: string;
}): string {
  return (
    env?.VALIDATION_PLUGINS_DIR ||
    process.env.VALIDATION_PLUGINS_DIR ||
    DEFAULT_VALIDATION_PLUGINS_DIR
  );
}
