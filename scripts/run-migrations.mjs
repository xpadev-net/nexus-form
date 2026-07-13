#!/usr/bin/env node

import { runMigrations } from "@nexus-form/database/migrate";

await runMigrations({
  migrationsFolder: process.env.DRIZZLE_MIGRATIONS_DIR ?? undefined,
});
