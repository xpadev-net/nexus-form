import { Hono } from "hono";

import type { DualAuthContext } from "./dual-auth";

// Define the environment type for all routes
export type Env = {
  Variables: {
    user: {
      id: string;
      email: string;
      name: string | null;
      role: string;
      createdAt: Date;
      updatedAt: Date;
      emailVerified: boolean;
      image?: string | null;
      isSuspended: boolean;
    } | null;
    session: {
      id: string;
      userId: string;
      expiresAt: Date;
      createdAt: Date;
      updatedAt: Date;
    } | null;
    dualAuthContext: DualAuthContext | null;
  };
};

// Factory to create typed Hono app
export const createHonoApp = () => new Hono<Env>();

// Re-export plain Hono for routers that don't access user context
export { Hono };
