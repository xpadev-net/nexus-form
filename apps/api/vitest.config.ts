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
        find: "@nexus-form/shared",
        replacement: fileURLToPath(
          new URL("../../packages/shared/src/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    testTimeout: 30000,
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
