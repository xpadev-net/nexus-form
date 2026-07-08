#!/usr/bin/env node

import { runMigrations } from "@nexus-form/database";

await runMigrations({
  migrationsFolder: process.env.DRIZZLE_MIGRATIONS_DIR ?? undefined,
});
