import { createRequire } from "node:module";

type DotenvConfigResult = {
  error?: Error;
};

type DotenvModule = {
  config(options: { path: string }): DotenvConfigResult;
};

type LoadEnvFileSyncOptions = {
  enabled: boolean;
  path: string;
  moduleUrl: string;
  logger?: Pick<Console, "warn">;
};

function isModuleNotFoundError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "MODULE_NOT_FOUND"
  );
}

export function loadEnvFileSync({
  enabled,
  path,
  moduleUrl,
  logger = console,
}: LoadEnvFileSyncOptions): void {
  if (!enabled) {
    return;
  }

  const require = createRequire(moduleUrl);

  try {
    const { config } = require("dotenv") as DotenvModule;
    const result = config({ path });

    if (result.error) {
      logger.warn(`[load-env] Failed to load ${path}: ${result.error.message}`);
    }
  } catch (error) {
    if (isModuleNotFoundError(error)) {
      logger.warn(
        "[load-env] dotenv is not installed; skipping environment file load",
      );
      return;
    }

    throw error;
  }
}
