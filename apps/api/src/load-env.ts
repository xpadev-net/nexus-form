import { resolve } from "node:path";
import dotenv from "dotenv";

// Load .env.local from monorepo root
dotenv.config({ path: resolve(import.meta.dirname, "../../../.env.local") });
