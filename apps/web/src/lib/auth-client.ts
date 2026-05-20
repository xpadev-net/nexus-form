import { createAuthClient } from "better-auth/react";
import { getRuntimeConfigValue } from "./runtime-config";

export const authClient = createAuthClient({
  baseURL: getRuntimeConfigValue(
    "apiUrl",
    import.meta.env.VITE_API_URL,
    "http://localhost:3001",
  ),
});
