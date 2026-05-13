import type { Context } from "hono";

export const notImplemented = (c: Context, endpoint: string) => {
  return c.json(
    {
      error: "Not implemented yet",
      endpoint,
    },
    501,
  );
};

export const ok = (
  c: Context,
  endpoint: string,
  extra?: Record<string, unknown>,
) => {
  return c.json({ ok: true, endpoint, ...extra });
};
