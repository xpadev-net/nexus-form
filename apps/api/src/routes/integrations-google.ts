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
  GoogleSheetsResponseSchema,
  GoogleSpreadsheetsResponseSchema,
} from "../types/domain/integrations-google";

const authorizeQuerySchema = z.object({
  state: z.string().optional(),
  scope: z.string().optional(),
  prompt: z.string().optional(),
  app_origin: z.string().optional(),
});

const googleTokenRefreshResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  scope: z.string().optional(),
});

const googleTokenExchangeResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  scope: z.string().optional(),
});

const googleOAuthScopesSchema = z.array(z.string());

const googleDriveFilesResponseSchema = z.object({
  files: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});

const googleSpreadsheetSheetsResponseSchema = z.object({
  sheets: z
    .array(
      z.object({
        properties: z
          .object({
            sheetId: z.number().optional(),
            title: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

function getCookieValue(cookie: string, name: string): string | undefined {
  const part = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return part?.split("=").slice(1).join("=");
}

function buildTrustedAppOrigins(): Set<string> {
  const origins: string[] = [];
  if (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test"
  ) {
    origins.push("http://localhost:3000");
  }
  if (process.env.TRUSTED_ORIGINS) {
    origins.push(
      ...process.env.TRUSTED_ORIGINS.split(",").map((origin) => origin.trim()),
    );
  }
  if (process.env.VITE_BASE_URL) {
    origins.push(process.env.VITE_BASE_URL);
  }
  return new Set(
    origins
      .map((origin) => normalizeHttpOrigin(origin))
      .filter((origin): origin is string => origin !== null),
  );
}

let trustedAppOrigins: Set<string> | null = null;

function getTrustedAppOrigins(): Set<string> {
  trustedAppOrigins ??= buildTrustedAppOrigins();
  return trustedAppOrigins;
}

export function resetTrustedAppOriginsForTesting(): void {
  trustedAppOrigins = null;
}

function normalizeHttpOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function decodeCookieValue(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function resolveAppOrigin(c: Context, requestedOrigin: string | undefined) {
  const trustedOrigins = getTrustedAppOrigins();
  const headerOrigin = c.req.header("origin");
  const origin = normalizeHttpOrigin(requestedOrigin ?? headerOrigin);
  if (origin && trustedOrigins.has(origin)) return origin;
  if (!requestedOrigin && !headerOrigin && trustedOrigins.size === 1) {
    return [...trustedOrigins][0];
  }
  return null;
}

function getCallbackTargetOrigin(cookie: string): string | null {
  const trustedOrigins = getTrustedAppOrigins();
  const encodedOrigin = getCookieValue(cookie, "google_oauth_app_origin");
  const storedOrigin = encodedOrigin
    ? normalizeHttpOrigin(decodeCookieValue(encodedOrigin) ?? undefined)
    : null;
  if (storedOrigin && trustedOrigins.has(storedOrigin)) return storedOrigin;
  const configuredDefaultOrigin = normalizeHttpOrigin(
    process.env.VITE_BASE_URL,
  );
  if (configuredDefaultOrigin && trustedOrigins.has(configuredDefaultOrigin)) {
    return configuredDefaultOrigin;
  }
  const [onlyTrustedOrigin] = trustedOrigins;
  if (trustedOrigins.size === 1 && onlyTrustedOrigin) return onlyTrustedOrigin;
  return null;
}

function escapeScriptJson(json: string): string {
  return json
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildOAuthCallbackHtml(params: {
  status: "error" | "success";
  targetOrigin: string | null;
  message?: string;
}): string {
  if (!params.targetOrigin) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>Google OAuth</title></head><body><p>${escapeHtml(params.message ?? "Google OAuth callback origin is not configured.")}</p><script>window.close();</script></body></html>`;
  }
  const payload = escapeScriptJson(
    JSON.stringify({
      source: "google-oauth",
      status: params.status,
      message: params.message,
    }),
  );
  const targetOrigin = escapeScriptJson(JSON.stringify(params.targetOrigin));
  return `<!doctype html><html><head><meta charset="utf-8"><title>Google OAuth</title></head><body><script>window.opener?.postMessage(${payload}, ${targetOrigin});window.close();</script></body></html>`;
}

function googleOAuthCookie(
  name: string,
  value: string,
  maxAge: number,
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    process.env.NODE_ENV === "production" ? "Secure" : null,
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function clearGoogleOAuthCookies(c: Context): void {
  c.header("Set-Cookie", googleOAuthCookie("google_oauth_state", "", 0));
  c.header("Set-Cookie", googleOAuthCookie("google_oauth_app_origin", "", 0), {
    append: true,
  });
}

function oauthCallbackResponse(
  c: Context,
  targetOrigin: string | null,
  status: "error" | "success",
  message?: string,
  clearCookies = true,
): Response {
  if (clearCookies) {
    clearGoogleOAuthCookies(c);
  }
  c.header("Content-Type", "text/html; charset=utf-8");
  return c.html(buildOAuthCallbackHtml({ status, targetOrigin, message }));
}

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
    scopes: googleOAuthScopesSchema.catch([]).parse(row.scopes),
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

  const parsed = googleTokenRefreshResponseSchema.safeParse(
    await response.json(),
  );
  if (!parsed.success) return null;
  const json = parsed.data;

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
    const appOrigin = resolveAppOrigin(c, parsed.data.app_origin);
    if (!appOrigin) return c.json({ error: "Invalid app origin" }, 400);
    const state =
      parsed.data.state && /^[A-Za-z0-9_-]{32,128}$/.test(parsed.data.state)
        ? parsed.data.state
        : randomUUID().replace(/-/g, "");

    c.header("Set-Cookie", googleOAuthCookie("google_oauth_state", state, 600));
    c.header(
      "Set-Cookie",
      googleOAuthCookie(
        "google_oauth_app_origin",
        encodeURIComponent(appOrigin),
        600,
      ),
      { append: true },
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
    const cookie = c.req.header("cookie") ?? "";
    const callbackTargetOrigin = getCallbackTargetOrigin(cookie);

    const parsed = callbackQuerySchema.safeParse(c.req.query());
    if (!parsed.success)
      return oauthCallbackResponse(
        c,
        callbackTargetOrigin,
        "error",
        "Invalid callback query",
        false,
      );
    if (!parsed.data.state) {
      return oauthCallbackResponse(
        c,
        callbackTargetOrigin,
        "error",
        "Missing OAuth state",
        false,
      );
    }

    const expectedState = getCookieValue(cookie, "google_oauth_state");
    if (!expectedState || expectedState !== parsed.data.state) {
      return oauthCallbackResponse(
        c,
        callbackTargetOrigin,
        "error",
        "Invalid OAuth state",
        false,
      );
    }
    const user = requireSessionUser(c);
    if (!user.ok) {
      return oauthCallbackResponse(
        c,
        callbackTargetOrigin,
        "error",
        "Session expired. Please try connecting again.",
      );
    }
    if (parsed.data.error)
      return oauthCallbackResponse(
        c,
        callbackTargetOrigin,
        "error",
        "OAuth was denied",
      );
    if (!parsed.data.code) {
      return oauthCallbackResponse(
        c,
        callbackTargetOrigin,
        "error",
        "Missing OAuth code",
      );
    }

    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return oauthCallbackResponse(
        c,
        callbackTargetOrigin,
        "error",
        "Google OAuth is not configured",
      );
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
      return oauthCallbackResponse(
        c,
        callbackTargetOrigin,
        "error",
        "Failed to exchange token",
      );
    }

    const tokenParsed = googleTokenExchangeResponseSchema.safeParse(
      await response.json(),
    );
    if (!tokenParsed.success) {
      return oauthCallbackResponse(
        c,
        callbackTargetOrigin,
        "error",
        "Unexpected token response format",
      );
    }
    const json = tokenParsed.data;

    if (!json.refresh_token) {
      return oauthCallbackResponse(
        c,
        callbackTargetOrigin,
        "error",
        "refresh_token not returned",
      );
    }

    await saveStoredToken({
      userId: user.userId,
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiryDate: new Date(Date.now() + json.expires_in * 1000).toISOString(),
      scopes: json.scope ? json.scope.split(" ") : [],
    });

    return oauthCallbackResponse(c, callbackTargetOrigin, "success");
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
    // Escape per Drive API rules: \ first, then ' (reversed order breaks escaping)
    const sanitizedQuery = query?.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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
    const rawParsed = googleDriveFilesResponseSchema.safeParse(
      await response.json(),
    );
    if (!rawParsed.success)
      return c.json({ error: "Unexpected response from Google API" }, 502);
    const raw = rawParsed.data;
    const spreadsheets = (raw.files ?? []).flatMap((file) =>
      typeof file.id === "string" ? [{ id: file.id, name: file.name }] : [],
    );

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

    const rawParsed = googleSpreadsheetSheetsResponseSchema.safeParse(
      await response.json(),
    );
    if (!rawParsed.success)
      return c.json({ error: "Unexpected response from Google API" }, 502);
    const raw = rawParsed.data;

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
