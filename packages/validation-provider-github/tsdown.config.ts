import { defineConfig } from "tsdown";

export default defineConfig([
  // Library output: file-per-source (unbundle) so other workspace packages
  // can statically import named exports.
  {
    entry: ["src/**/*.ts", "!src/**/*.d.ts", "!src/**/__tests__/**/*.test.ts"],
    format: "esm",
    platform: "node",
    target: "node20",
    outDir: "dist",
    unbundle: true,
    outExtensions: () => ({ js: ".js" }),
    dts: false,
    clean: false,
  },
  // Plugin bundle: single self-contained `.mjs` for the validation
  // PluginLoader. Bundles every dependency (including npm packages) so the
  // file can be dropped into any directory and loaded by Node's dynamic
  // `import()` without relying on the host's node_modules layout.
  {
    entry: { plugin: "src/plugin.ts" },
    format: "esm",
    platform: "node",
    target: "node20",
    outDir: "dist",
    outExtensions: () => ({ js: ".mjs" }),
    deps: { alwaysBundle: [/.*/] },
    dts: false,
    clean: false,
  },
]);
