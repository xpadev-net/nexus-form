import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts",
    "!src/**/__tests__/**",
  ],
  format: "esm",
  platform: "node",
  target: "node20",
  outDir: "dist",
  unbundle: true,
  outExtensions: () => ({ js: ".mjs" }),
  dts: false,
  clean: false,
});
