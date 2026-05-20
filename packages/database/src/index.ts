import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const pool = mysql.createPool(connectionString);
export const db = drizzle(pool, {
  schema: { ...authSchema, ...appSchema },
  mode: "default",
});

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export { sql } from "drizzle-orm";
export * from "./auth-schema";
export { runMigrations } from "./migrate";
export * from "./schema";
