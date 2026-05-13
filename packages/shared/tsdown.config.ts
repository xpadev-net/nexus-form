import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/**/*.ts", "!src/**/*.d.ts", "!src/**/__tests__/**/*.test.ts"],
  format: "esm",
  platform: "node",
  target: "node20",
  outDir: "dist",
  unbundle: true,
  outExtensions: () => ({ js: ".js" }),
  dts: false,
  clean: false,
});
