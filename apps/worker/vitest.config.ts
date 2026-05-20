import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@nexus-form/shared/crypto/field-encryption",
        replacement: fileURLToPath(
          new URL(
            "../../packages/shared/src/crypto/field-encryption.ts",
            import.meta.url,
          ),
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
