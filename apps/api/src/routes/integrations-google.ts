import { randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import { googleOAuthToken } from "@nexus-form/database/schema";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import {
  decryptFromBase64,
  encryptToBase64,
} from "../lib/crypto/field-encryption";
import { withDualAuth } from "../lib/dual-auth";
import { createHonoApp } from "../lib/hono";
import {
  GoogleCallbackResponseSchema,
  GoogleSheetsResponseSchema,
  GoogleSpreadsheetsResponseSchema,
} from "../types/domain/integrations-google";

const authorizeQuerySchema = z.object({
  state: z.string().optional(),
  scope: z.string().optional(),
  prompt: z.string().optional(),
});

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

function buildAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  prompt: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", params.prompt);
  url.searchParams.set("state", params.state);
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

type StoredGoogleToken = {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiryDate: string;
  scopes: string[];
};

async function getStoredToken(
  userId: string,
): Promise<StoredGoogleToken | null> {
  const [row] = await db
    .select()
    .from(googleOAuthToken)
    .where(eq(googleOAuthToken.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    userId,
    accessToken: decryptFromBase64(row.accessTokenEnc),
    refreshToken: decryptFromBase64(row.refreshTokenEnc),
    expiryDate: row.expiryDate.toISOString(),
    scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
  };
}

async function saveStoredToken(token: StoredGoogleToken): Promise<void> {
  const accessTokenEnc = encryptToBase64(token.accessToken);
  const refreshTokenEnc = encryptToBase64(token.refreshToken);
  const expiryDate = new Date(token.expiryDate);

  const [existing] = await db
    .select({ id: googleOAuthToken.id })
    .from(googleOAuthToken)
    .where(eq(googleOAuthToken.userId, token.userId))
    .limit(1);

  if (existing) {
    await db
      .update(googleOAuthToken)
      .set({
        accessTokenEnc,
        refreshTokenEnc,
        expiryDate,
        scopes: token.scopes,
      })
      .where(eq(googleOAuthToken.userId, token.userId));
    return;
  }

  await db.insert(googleOAuthToken).values({
    id: randomUUID(),
    userId: token.userId,
    provider: "google",
    accessTokenEnc,
    refreshTokenEnc,
    expiryDate,
    scopes: token.scopes,
  });
}

async function refreshIfNeeded(
  token: StoredGoogleToken,
): Promise<StoredGoogleToken | null> {
  const skewMs = 60_000;
  const expiryMs = Date.parse(token.expiryDate);
  if (!Number.isNaN(expiryMs) && expiryMs - skewMs > Date.now()) {
    return token;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return null;

  const json = (await response.json()) as {
    access_token: string;
    expires_in: number;
    scope?: string;
  };

  const updated: StoredGoogleToken = {
    ...token,
    accessToken: json.access_token,
    expiryDate: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    scopes: json.scope ? json.scope.split(" ") : token.scopes,
  };
  await saveStoredToken(updated);
  return updated;
}

function requireSessionUser(
  c: Context,
): { ok: true; userId: string } | { ok: false; response: Response } {
  const auth = c.get("dualAuthContext");
  if (!auth || auth.auth_type !== "session") {
    return { ok: false, response: c.json({ error: "Unauthorized" }, 401) };
  }
  return { ok: true, userId: auth.user_id };
}

export const integrationsGoogleRouter = createHonoApp()
  .use("/*", withDualAuth())
  .get("/authorize", async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    const parsed = authorizeQuerySchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: "Invalid query parameters" }, 400);

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId)
      return c.json({ error: "Google OAuth is not configured" }, 503);

    const scope =
      parsed.data.scope ??
      [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.readonly",
      ].join(" ");
    const prompt = parsed.data.prompt ?? "consent";
    const origin = c.req.header("origin") || new URL(c.req.url).origin;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || origin;
    const redirectUri = new URL(
      "/api/integrations/google/callback",
      baseUrl,
    ).toString();
    const state =
      parsed.data.state && /^[A-Za-z0-9_-]{32,128}$/.test(parsed.data.state)
        ? parsed.data.state
        : randomUUID().replace(/-/g, "");

    c.header(
      "Set-Cookie",
      [
        `google_oauth_state=${state}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        process.env.NODE_ENV === "production" ? "Secure" : null,
        "Max-Age=600",
      ]
        .filter(Boolean)
        .join("; "),
    );
    return c.redirect(
      buildAuthorizeUrl({
        clientId,
        redirectUri,
        scope,
        state,
        prompt,
      }),
      302,
    );
  })
  .get("/callback", async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    const parsed = callbackQuerySchema.safeParse(c.req.query());
    if (!parsed.success)
      return c.json({ error: "Invalid callback query" }, 400);
    if (parsed.data.error) return c.json({ error: "OAuth was denied" }, 401);
    if (!parsed.data.code || !parsed.data.state) {
      return c.json({ error: "Missing code/state" }, 400);
    }

    const cookie = c.req.header("cookie") ?? "";
    const expectedState = cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("google_oauth_state="))
      ?.split("=")[1];
    if (!expectedState || expectedState !== parsed.data.state) {
      return c.json({ error: "Invalid OAuth state" }, 401);
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return c.json({ error: "Google OAuth is not configured" }, 503);
    }

    const origin = c.req.header("origin") || new URL(c.req.url).origin;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || origin;
    const redirectUri = new URL(
      "/api/integrations/google/callback",
      baseUrl,
    ).toString();

    const body = new URLSearchParams({
      code: parsed.data.code,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      return c.json({ error: "Failed to exchange token" }, 502);
    }

    const json = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };

    if (!json.refresh_token) {
      return c.json({ error: "refresh_token not returned" }, 502);
    }

    await saveStoredToken({
      userId: user.userId,
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiryDate: new Date(Date.now() + json.expires_in * 1000).toISOString(),
      scopes: json.scope ? json.scope.split(" ") : [],
    });

    c.header(
      "Set-Cookie",
      `google_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
    return c.json(GoogleCallbackResponseSchema.parse({ success: true }));
  })
  .get("/spreadsheets", async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    let token = await getStoredToken(user.userId);
    if (!token) return c.json({ error: "Google account not connected" }, 401);
    token = await refreshIfNeeded(token);
    if (!token) return c.json({ error: "Google account unauthorized" }, 401);

    const query = c.req.query("query");
    const pageSize = c.req.query("pageSize");
    const pageToken = c.req.query("pageToken");
    // Escape single quotes to prevent Google Drive API query injection
    const sanitizedQuery = query?.replace(/'/g, "\\'");
    const q = `mimeType='application/vnd.google-apps.spreadsheet'${sanitizedQuery ? ` and name contains '${sanitizedQuery}'` : ""}`;

    const params = new URLSearchParams({
      q,
      fields: "files(id,name),nextPageToken",
    });
    if (pageSize) params.set("pageSize", pageSize);
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      },
    );
    if (!response.ok)
      return c.json({ error: "Failed to fetch spreadsheet list" }, 502);
    const raw = (await response.json()) as {
      files?: Array<{ id?: string; name?: string }>;
      nextPageToken?: string;
    };
    const spreadsheets = (raw.files ?? [])
      .filter((file) => typeof file.id === "string")
      .map((file) => ({ id: file.id as string, name: file.name }));

    const parsed = GoogleSpreadsheetsResponseSchema.safeParse({
      spreadsheets,
      nextPageToken: raw.nextPageToken,
    });
    if (!parsed.success)
      return c.json({ error: "Unexpected response from Google API" }, 502);
    return c.json(parsed.data);
  })
  .get("/spreadsheets/:id/sheets", async (c) => {
    const user = requireSessionUser(c);
    if (!user.ok) return user.response;

    const spreadsheetId = c.req.param("id");
    if (!spreadsheetId) return c.json({ error: "No spreadsheet id" }, 400);

    let token = await getStoredToken(user.userId);
    if (!token) return c.json({ error: "Google account not connected" }, 401);
    token = await refreshIfNeeded(token);
    if (!token) return c.json({ error: "Google account unauthorized" }, 401);

    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(sheetId,title))`,
      {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      },
    );

    if (!response.ok)
      return c.json({ error: "Failed to fetch sheets list" }, 502);

    const raw = (await response.json()) as {
      sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
    };

    const sheets = (raw.sheets ?? [])
      .map((entry) => ({
        sheetId: entry.properties?.sheetId,
        title: entry.properties?.title ?? "",
      }))
      .filter((entry) => entry.title.length > 0);

    const parsedSheets = GoogleSheetsResponseSchema.safeParse({ sheets });
    if (!parsedSheets.success)
      return c.json({ error: "Unexpected response from Google API" }, 502);
    return c.json(parsedSheets.data);
  });
