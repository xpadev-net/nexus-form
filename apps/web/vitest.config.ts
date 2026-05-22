import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@nexus-form/shared/forms/form-block",
        replacement: fileURLToPath(
          new URL(
            "../../packages/shared/src/forms/form-block.ts",
            import.meta.url,
          ),
        ),
      },
      {
        find: "@",
        replacement: fileURLToPath(new URL("./src", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    exclude: ["**/node_modules/**", "**/dist/**"],
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
