import { db, user as userTable } from "@nexus-form/database";
import { apiToken, formShareLink } from "@nexus-form/database/schema";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import type { AuthContext, TokenScope } from "../../types/api/auth";
import { logError } from "../logger";
import { computeLookupHash, verifyToken } from "./hash";

/**
 * APIトークンを検証し、認証コンテキストを返す
 * @param token プレーンテキストのトークン
 * @returns 認証コンテキスト（無効な場合はnull）
 */
type ValidateApiTokenOptions = {
  updateLastUsedAt?: boolean;
};

export class SuspendedTokenOwnerError extends Error {
  static readonly MESSAGE = "Your account has been suspended";

  constructor() {
    super("Token owner account is suspended");
    this.name = "SuspendedTokenOwnerError";
  }
}

const selectTokenFields = {
  id: apiToken.id,
  tokenHash: apiToken.tokenHash,
  userId: apiToken.userId,
  scopes: apiToken.scopes,
  formIds: apiToken.formIds,
  type: apiToken.type,
  shareLinkId: apiToken.shareLinkId,
};

type TokenRecord = {
  id: string;
  tokenHash: string;
  userId: string | null;
  scopes: unknown;
  formIds: unknown;
  type: "USER" | "FORM" | "SHARE_LINK";
  shareLinkId: string | null;
};

function getActiveTokenCondition() {
  return and(
    eq(apiToken.isActive, true),
    isNull(apiToken.revokedAt),
    or(isNull(apiToken.expiresAt), gt(apiToken.expiresAt, new Date())),
  );
}

type TokenOwnerStatus = "active" | "missing" | "none" | "suspended";

async function getTokenOwnerStatus(
  userId: string | null,
): Promise<TokenOwnerStatus> {
  if (!userId) return "none";

  const [owner] = await db
    .select({ isSuspended: userTable.isSuspended })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  if (!owner) return "missing";
  return owner.isSuspended ? "suspended" : "active";
}

async function buildAuthContextFromTokenRecord(
  token: string,
  tokenRecord: TokenRecord,
  options: ValidateApiTokenOptions,
): Promise<AuthContext | null> {
  const isValid = await verifyToken(token, tokenRecord.tokenHash);
  if (!isValid) return null;

  const ownerStatus = await getTokenOwnerStatus(tokenRecord.userId);
  if (ownerStatus === "missing") return null;
  if (ownerStatus === "suspended") {
    throw new SuspendedTokenOwnerError();
  }

  if (options.updateLastUsedAt ?? true) {
    void db
      .update(apiToken)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiToken.id, tokenRecord.id))
      .catch((err: unknown) => {
        logError("Failed to update token lastUsedAt", "authentication", {
          error: err,
        });
      });
  }

  if (tokenRecord.type === "SHARE_LINK" && tokenRecord.shareLinkId) {
    const [link] = await db
      .select({
        id: formShareLink.id,
        isActive: formShareLink.isActive,
        expiresAt: formShareLink.expiresAt,
      })
      .from(formShareLink)
      .where(eq(formShareLink.id, tokenRecord.shareLinkId))
      .limit(1);

    if (!link?.isActive) return null;
    if (link.expiresAt && link.expiresAt <= new Date()) return null;
  }

  return {
    user_id: tokenRecord.userId ?? null,
    token_id: tokenRecord.id,
    scopes: (tokenRecord.scopes as TokenScope[]) ?? [],
    form_ids: (tokenRecord.formIds as string[] | undefined) ?? undefined,
    is_admin: false,
  };
}

export async function validateApiToken(
  token: string,
  options: ValidateApiTokenOptions = {},
): Promise<AuthContext | null> {
  try {
    if (!token.startsWith("ct_")) {
      return null;
    }

    const activeCondition = getActiveTokenCondition();

    // O(1) lookup by SHA-256 lookupHash
    const lookupHash = computeLookupHash(token);
    const [tokenRecord] = await db
      .select(selectTokenFields)
      .from(apiToken)
      .where(and(eq(apiToken.lookupHash, lookupHash), activeCondition))
      .limit(1);

    if (!tokenRecord) return null;

    return await buildAuthContextFromTokenRecord(token, tokenRecord, options);
  } catch (error) {
    if (error instanceof SuspendedTokenOwnerError) throw error;
    logError("Token validation error", "authentication", { error });
    return null;
  }
}

export async function validateApiTokenForUser(
  token: string,
  userId: string,
  options: ValidateApiTokenOptions = {},
): Promise<AuthContext | null> {
  try {
    if (!token.startsWith("ct_")) {
      return null;
    }

    const lookupHash = computeLookupHash(token);
    const [tokenRecord] = await db
      .select(selectTokenFields)
      .from(apiToken)
      .where(
        and(
          eq(apiToken.lookupHash, lookupHash),
          eq(apiToken.userId, userId),
          getActiveTokenCondition(),
        ),
      )
      .limit(1);

    if (!tokenRecord) return null;

    return await buildAuthContextFromTokenRecord(token, tokenRecord, options);
  } catch (error) {
    if (error instanceof SuspendedTokenOwnerError) throw error;
    logError("User token validation error", "authentication", { error });
    return null;
  }
}

/**
 * トークンが指定されたスコープを持っているかチェックする
 */
export async function validateApiTokenWithScopes(
  token: string,
  requiredScopes: TokenScope[],
): Promise<AuthContext | null> {
  const authContext = await validateApiToken(token);
  if (!authContext) {
    return null;
  }

  const hasRequired = requiredScopes.every(
    (scope) =>
      authContext.scopes.includes(scope) ||
      authContext.scopes.includes("admin"),
  );

  if (!hasRequired) {
    return null;
  }

  return authContext;
}

/**
 * トークンが特定のフォームにアクセスできるかチェックする
 */
export async function validateApiTokenForForm(
  token: string,
  formId: string,
): Promise<AuthContext | null> {
  const authContext = await validateApiToken(token);
  if (!authContext) {
    return null;
  }

  if (authContext.form_ids && !authContext.form_ids.includes(formId)) {
    return null;
  }

  return authContext;
}
