import { resolve } from "node:path";

if (process.env.NODE_ENV !== "production") {
  const dotenvPath = resolve(import.meta.dirname, "../../../.env.local");

  try {
    const { config } = await import("dotenv");
    config({ path: dotenvPath });
  } catch {
    // dotenv is optional in non-production environments.
    // This allows production images that don't install dotenv to boot successfully.
  }
}
