/**
 * Standalone migration script for Docker runtime.
 * Runs Drizzle migrations from the bundled SQL files using mysql2.
 */

import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const migrationClient = await mysql.createConnection(connectionString);
const db = drizzle(migrationClient);

console.log("Running database migrations...");

try {
  const migrationsFolder = resolve(__dirname, "./drizzle");
  await migrate(db, { migrationsFolder });
  console.log("Database migrations completed successfully");
} catch (error) {
  console.error("Database migration failed:", error);
  process.exit(1);
} finally {
  await migrationClient.end();
}
