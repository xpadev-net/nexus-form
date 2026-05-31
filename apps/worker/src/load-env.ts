import { resolve } from "node:path";
import { loadEnvFileSync } from "@nexus-form/shared/node/load-env";

loadEnvFileSync({
  enabled: process.env.NODE_ENV !== "production",
  path: resolve(import.meta.dirname, "../../../.env.local"),
  moduleUrl: import.meta.url,
});
