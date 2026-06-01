import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption } from "vite";
import { injectRuntimeConfigScript } from "./src/lib/runtime-config-script";

const envDir = fileURLToPath(new URL("../../", import.meta.url));

function runtimeConfigPlugin(mode: string): PluginOption {
  const env = {
    ...loadEnv(mode, envDir, "VITE_"),
    ...process.env,
  };

  return {
    name: "nexus-form-runtime-config",
    transformIndexHtml(html) {
      return injectRuntimeConfigScript(html, env);
    },
  };
}

export default defineConfig(({ mode }) => ({
  envDir,
  plugins: [
    runtimeConfigPlugin(mode),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    viteReact(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@content": fileURLToPath(new URL("../../content", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-tanstack": [
            "@tanstack/react-router",
            "@tanstack/react-query",
          ],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
}));
