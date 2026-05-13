import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/schema.ts", "./src/auth-schema.ts"],
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: (() => {
      const url = process.env.DATABASE_URL;
      if (!url)
        throw new Error("DATABASE_URL environment variable is required");
      return url;
    })(),
  },
});
