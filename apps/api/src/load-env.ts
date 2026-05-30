import { createRequire } from "node:module";
import { resolve } from "node:path";

if (process.env.NODE_ENV !== "production") {
  const dotenvPath = resolve(import.meta.dirname, "../../../.env.local");
  const require = createRequire(import.meta.url);

  try {
    const { config } = require("dotenv") as typeof import("dotenv");
    const result = config({ path: dotenvPath });

    if (result.error) {
      console.warn(
        `[load-env] Failed to load ${dotenvPath}: ${result.error.message}`,
      );
    }
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "MODULE_NOT_FOUND"
    ) {
      // dotenv が未インストールでも非本番環境では起動は継続する
      console.warn(
        "[load-env] dotenv is not installed; skipping environment file load",
      );
    } else {
      throw error;
    }
  }
}
