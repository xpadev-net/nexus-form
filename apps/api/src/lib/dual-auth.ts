import { db } from "@nexus-form/database";
import {
  apiToken as apiTokenTable,
  form,
  formPermission,
  formShareLink,
} from "@nexus-form/database/schema";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { TokenScope } from "../types/api/auth";
import { auth } from "./auth";
import { ERROR_CODES } from "./constants/error-codes";
import {
  FormNotFoundError,
  FormPermissionError,
  InsufficientFormPermissionError,
} from "./errors/form-errors";
import type { Env } from "./hono";
import { logError } from "./logger";
import {
  FORM_ROLE_PRIORITY,
  type FormPermissionRole,
} from "./permissions/constants";
import {
  validateApiToken,
  validateApiTokenForForm,
  validateApiTokenWithScopes,
} from "./tokens";

/**
 * 統合認証コンテキスト
 * API token認証、Better Authセッション認証に対応
 */
export interface DualAuthContext {
  user_id: string;
  token_id?: string;
  scopes?: TokenScope[];
  form_ids?: string[];
  session?: {
    user: { id: string; [key: string]: unknown };
    session: { id: string; [key: string]: unknown };
  };
  auth_type: "api_token" | "session";
  share_link_id?: string;
}

const ERROR_MESSAGES = {
  MISSING_AUTH: "Authentication required",
  INVALID_TOKEN: "Invalid or expired token",
  INSUFFICIENT_PERMISSIONS: "Insufficient permissions",
  FORM_ACCESS_DENIED: "Access denied to this form",
  ACCOUNT_SUSPENDED: "アカウントが停止されています",
  AUTH_FAILED: "Authentication failed",
} as const;

/**
 * Bearer トークンを抽出する
 */
function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const trimmed = authHeader.trim();
  const [scheme, ...rest] = trimmed.split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ");
  return token || null;
}

function isSuspendedSessionContext(context: DualAuthContext): boolean {
  return (
    context.auth_type === "session" &&
    context.session?.user?.isSuspended === true
  );
}

function suspendedAccountResponse(c: Context): Response {
  return c.json(
    {
      error: {
        message: ERROR_MESSAGES.ACCOUNT_SUSPENDED,
        code: ERROR_CODES.FORBIDDEN,
      },
    },
    403,
  );
}

/**
 * API トークン認証を試行する
 */
async function authenticateWithApiToken(
  c: Context,
  formId?: string,
  requiredScopes: TokenScope[] = [],
): Promise<DualAuthContext | null> {
  const token = extractBearerToken(c.req.header("authorization") ?? null);
  if (!token) return null;

  try {
    if (formId) {
      const authContext = await validateApiTokenForForm(token, formId);
      if (!authContext) return null;

      if (requiredScopes.length > 0) {
        const hasRequired = requiredScopes.every(
          (scope) =>
            authContext.scopes.includes(scope) ||
            authContext.scopes.includes("admin"),
        );
        if (!hasRequired) return null;
      }

      let userId = authContext.user_id ?? null;
      let shareLinkId: string | undefined;
      if (!userId && authContext.token_id) {
        const [rec] = await db
          .select({ shareLinkId: apiTokenTable.shareLinkId })
          .from(apiTokenTable)
          .where(eq(apiTokenTable.id, authContext.token_id))
          .limit(1);
        shareLinkId = rec?.shareLinkId ?? undefined;
        userId = shareLinkId
          ? `share-link:${shareLinkId}`
          : `anon:${authContext.token_id}`;
      }

      if (!userId) return null;

      return {
        user_id: userId,
        token_id: authContext.token_id,
        scopes: authContext.scopes,
        form_ids: authContext.form_ids,
        auth_type: "api_token",
        ...(shareLinkId ? { share_link_id: shareLinkId } : {}),
      };
    }

    const authContext =
      requiredScopes.length > 0
        ? await validateApiTokenWithScopes(token, requiredScopes)
        : await validateApiToken(token);

    if (!authContext) return null;
    if (!authContext.user_id) return null;

    return {
      user_id: authContext.user_id,
      token_id: authContext.token_id,
      scopes: authContext.scopes,
      form_ids: authContext.form_ids,
      auth_type: "api_token",
    };
  } catch (error) {
    logError("API token authentication failed", "authentication", {
      error,
      operation: "apiTokenAuthentication",
      formId,
    });
    return null;
  }
}

/**
 * Better Auth セッション認証を試行する
 */
async function authenticateWithSession(
  c: Context,
): Promise<DualAuthContext | null> {
  try {
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (!session?.user?.id) {
      return null;
    }

    return {
      user_id: session.user.id,
      session,
      auth_type: "session",
    };
  } catch (error) {
    logError("Session authentication failed", "authentication", {
      error,
      operation: "sessionAuthentication",
    });
    return null;
  }
}

/**
 * 統合認証を実行する
 * Bearer ヘッダがあれば API トークン認証、なければセッション認証
 */
export async function authenticateDual(
  c: Context,
  requiredScopes: TokenScope[] = [],
): Promise<{ context: DualAuthContext } | { error: true; response: Response }> {
  try {
    const raw = (c.req.header("authorization") ?? "").trim();
    const isBearer = raw.toLowerCase().startsWith("bearer ");

    const context = isBearer
      ? await authenticateWithApiToken(c, undefined, requiredScopes)
      : await authenticateWithSession(c);

    if (context) {
      if (isSuspendedSessionContext(context)) {
        return {
          error: true,
          response: suspendedAccountResponse(c),
        };
      }

      // Validate scopes for session auth (API token scopes are checked in authenticateWithApiToken)
      if (
        requiredScopes.length > 0 &&
        !validateScopes(context, requiredScopes)
      ) {
        return {
          error: true,
          response: c.json(
            {
              error: {
                message: ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS,
                code: ERROR_CODES.FORBIDDEN,
              },
            },
            403,
          ),
        };
      }
      return { context };
    }

    if (isBearer) {
      return {
        error: true,
        response: c.json(
          {
            error: {
              message: ERROR_MESSAGES.INVALID_TOKEN,
              code: ERROR_CODES.UNAUTHORIZED,
            },
          },
          401,
        ),
      };
    }

    return {
      error: true,
      response: c.json(
        {
          error: {
            message: ERROR_MESSAGES.MISSING_AUTH,
            code: ERROR_CODES.UNAUTHORIZED,
          },
        },
        401,
      ),
    };
  } catch (error) {
    logError("Dual authentication failed", "authentication", {
      error,
      operation: "authenticateDual",
    });
    return {
      error: true,
      response: c.json(
        {
          error: {
            message: ERROR_MESSAGES.AUTH_FAILED,
            code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          },
        },
        500,
      ),
    };
  }
}

/**
 * フォームアクセス権限付き統合認証を実行する
 */
export async function authenticateDualForForm(
  c: Context,
  formId: string,
  requiredScopes: TokenScope[] = [],
): Promise<{ context: DualAuthContext } | { error: true; response: Response }> {
  try {
    const raw = (c.req.header("authorization") ?? "").trim();
    const isBearer = raw.toLowerCase().startsWith("bearer ");

    const context = isBearer
      ? await authenticateWithApiToken(c, formId, requiredScopes)
      : await authenticateWithSession(c);

    if (context) {
      if (isSuspendedSessionContext(context)) {
        return {
          error: true,
          response: suspendedAccountResponse(c),
        };
      }

      // Validate scopes for session auth (API token scopes are checked in authenticateWithApiToken)
      if (
        requiredScopes.length > 0 &&
        !validateScopes(context, requiredScopes)
      ) {
        return {
          error: true,
          response: c.json(
            {
              error: {
                message: ERROR_MESSAGES.INSUFFICIENT_PERMISSIONS,
                code: ERROR_CODES.FORBIDDEN,
              },
            },
            403,
          ),
        };
      }
      return { context };
    }

    if (isBearer) {
      return {
        error: true,
        response: c.json(
          {
            error: {
              message: ERROR_MESSAGES.INVALID_TOKEN,
              code: ERROR_CODES.UNAUTHORIZED,
            },
          },
          401,
        ),
      };
    }

    return {
      error: true,
      response: c.json(
        {
          error: {
            message: ERROR_MESSAGES.MISSING_AUTH,
            code: ERROR_CODES.UNAUTHORIZED,
          },
        },
        401,
      ),
    };
  } catch (error) {
    logError("Dual authentication for form failed", "authentication", {
      error,
      operation: "authenticateDualForForm",
      formId,
    });
    return {
      error: true,
      response: c.json(
        {
          error: {
            message: ERROR_MESSAGES.AUTH_FAILED,
            code: ERROR_CODES.INTERNAL_SERVER_ERROR,
          },
        },
        500,
      ),
    };
  }
}

/**
 * スコープ検証ロジック
 */
export function validateScopes(
  context: DualAuthContext,
  requiredScopes: TokenScope[],
): boolean {
  if (context.auth_type === "session") {
    // Session users with admin scope requirement must have admin role
    if (requiredScopes.includes("admin" as TokenScope)) {
      const userRole = context.session?.user?.role as string | undefined;
      return userRole === "admin";
    }
    return true;
  }

  if (context.auth_type === "api_token" && context.scopes) {
    return requiredScopes.every(
      (scope) =>
        context.scopes?.includes(scope) || context.scopes?.includes("admin"),
    );
  }

  return false;
}

/**
 * 共有リンクのロールを取得し基本検証を行う
 */
async function getShareLinkRole(
  shareLinkId: string,
  expectedFormId: string,
): Promise<"EDITOR" | "VIEWER" | null> {
  const [link] = await db
    .select({
      id: formShareLink.id,
      role: formShareLink.role,
      isActive: formShareLink.isActive,
      formId: formShareLink.formId,
    })
    .from(formShareLink)
    .where(eq(formShareLink.id, shareLinkId))
    .limit(1);

  if (!link?.isActive) return null;
  if (link.formId !== expectedFormId) return null;
  return link.role as "EDITOR" | "VIEWER";
}

/**
 * フォームロールの充足判定
 */
function formRoleSatisfies(
  required: FormPermissionRole,
  actual: FormPermissionRole | null,
): boolean {
  if (!actual) return false;
  return FORM_ROLE_PRIORITY[actual] >= FORM_ROLE_PRIORITY[required];
}

/**
 * フォーム権限レベルをチェックする
 */
export async function checkFormPermissionLevel(
  context: DualAuthContext,
  formId: string,
  requiredRole: FormPermissionRole,
): Promise<void> {
  if (context.auth_type === "session") {
    // フォームを検索
    const [formRecord] = await db
      .select({ id: form.id, creatorId: form.creatorId })
      .from(form)
      .where(eq(form.id, formId))
      .limit(1);

    if (!formRecord) {
      throw new FormNotFoundError(formId);
    }

    // クリエーターは OWNER 権限を持つ
    if (formRecord.creatorId === context.user_id) {
      return;
    }

    // formId AND userId の両方でフィルタリングして権限を取得
    const [exactPerm] = await db
      .select({ role: formPermission.role })
      .from(formPermission)
      .where(
        and(
          eq(formPermission.formId, formId),
          eq(formPermission.userId, context.user_id),
        ),
      )
      .limit(1);

    const effectiveRole = exactPerm
      ? (exactPerm.role as FormPermissionRole)
      : null;

    if (!formRoleSatisfies(requiredRole, effectiveRole)) {
      throw new InsufficientFormPermissionError(
        formId,
        requiredRole,
        effectiveRole,
      );
    }
  }

  if (context.auth_type === "api_token") {
    // フォーム存在確認
    const [formRecord] = await db
      .select({ id: form.id, creatorId: form.creatorId })
      .from(form)
      .where(eq(form.id, formId))
      .limit(1);

    if (!formRecord) throw new FormNotFoundError(formId);

    // form_ids 制限
    if (context.form_ids && !context.form_ids.includes(formId)) {
      throw new InsufficientFormPermissionError(formId, requiredRole, null);
    }

    // 共有リンク API トークンの場合
    if (context.share_link_id) {
      const role = await getShareLinkRole(context.share_link_id, formId);
      if (!role) {
        throw new InsufficientFormPermissionError(formId, requiredRole, null);
      }

      if (requiredRole === "VIEWER") return;
      if (requiredRole === "EDITOR") {
        if (role === "EDITOR") return;
        throw new InsufficientFormPermissionError(
          formId,
          requiredRole,
          "VIEWER",
        );
      }
      if (requiredRole === "OWNER") {
        throw new InsufficientFormPermissionError(formId, requiredRole, role);
      }
      return;
    }

    // anon トークン (user_id が "anon:" プレフィックス) は DB 権限を持たない。
    // このプレフィックス形式は authenticateWithApiToken の構築ロジックに依存。
    if (context.user_id.startsWith("anon:")) {
      throw new InsufficientFormPermissionError(formId, requiredRole, null);
    }

    // ユーザースコープのトークン: セッションブランチと同等の DB 権限チェック
    if (formRecord.creatorId === context.user_id) return;

    const [exactPerm] = await db
      .select({ role: formPermission.role })
      .from(formPermission)
      .where(
        and(
          eq(formPermission.formId, formId),
          eq(formPermission.userId, context.user_id),
        ),
      )
      .limit(1);

    const effectiveRole = exactPerm
      ? (exactPerm.role as FormPermissionRole)
      : null;

    if (!formRoleSatisfies(requiredRole, effectiveRole)) {
      throw new InsufficientFormPermissionError(
        formId,
        requiredRole,
        effectiveRole,
      );
    }
    return;
  }
}

/**
 * フォームアクセス権限をチェックする
 */
export async function checkFormAccess(
  context: DualAuthContext,
  formId: string,
): Promise<boolean> {
  if (context.auth_type === "session") {
    const [formRecord] = await db
      .select({ id: form.id, creatorId: form.creatorId })
      .from(form)
      .where(eq(form.id, formId))
      .limit(1);

    if (!formRecord) return false;
    if (formRecord.creatorId === context.user_id) return true;

    const [perm] = await db
      .select({ role: formPermission.role })
      .from(formPermission)
      .where(
        and(
          eq(formPermission.formId, formId),
          eq(formPermission.userId, context.user_id),
        ),
      )
      .limit(1);

    return !!perm;
  }

  if (context.auth_type === "api_token") {
    if (context.form_ids && !context.form_ids.includes(formId)) {
      return false;
    }

    if (context.share_link_id) {
      const role = await getShareLinkRole(context.share_link_id, formId);
      return role === "VIEWER" || role === "EDITOR";
    }

    // anon トークンは DB 権限を持たない
    if (context.user_id.startsWith("anon:")) return false;

    // ユーザースコープのトークン: 実際の DB 権限を確認
    const [formRecord] = await db
      .select({ id: form.id, creatorId: form.creatorId })
      .from(form)
      .where(eq(form.id, formId))
      .limit(1);

    if (!formRecord) return false;
    if (formRecord.creatorId === context.user_id) return true;

    const [perm] = await db
      .select({ role: formPermission.role })
      .from(formPermission)
      .where(
        and(
          eq(formPermission.formId, formId),
          eq(formPermission.userId, context.user_id),
        ),
      )
      .limit(1);

    return !!perm;
  }

  return false;
}

/**
 * 指定フォームへの編集権限があるかチェック
 */
export async function hasEditPermission(
  context: DualAuthContext,
  formId: string,
): Promise<boolean> {
  if (context.auth_type === "api_token") {
    const scopes = context.scopes ?? [];
    if (
      !scopes.includes("write" as TokenScope) &&
      !scopes.includes("admin" as TokenScope)
    ) {
      return false;
    }
  }
  try {
    await checkFormPermissionLevel(context, formId, "EDITOR");
    return true;
  } catch {
    return false;
  }
}

/**
 * Dual Auth Hono ミドルウェア
 * 認証を実行し、コンテキストに DualAuthContext を設定する
 */
export function withDualAuth(requiredScopes: TokenScope[] = []) {
  return createMiddleware<Env>(async (c, next) => {
    const result = await authenticateDual(c, requiredScopes);
    if ("error" in result) {
      return result.response;
    }
    c.set("dualAuthContext", result.context);
    return next();
  });
}

/**
 * フォームアクセス権限付き Dual Auth Hono ミドルウェア
 * formId はパスパラメータ `:id` から自動取得する
 */
export function withDualFormAuth(
  requiredRole: FormPermissionRole = "VIEWER",
  requiredScopes: TokenScope[] = [],
) {
  return createMiddleware<Env>(async (c, next) => {
    const formId = c.req.param("id");
    if (!formId) {
      return c.json(
        {
          error: {
            message: ERROR_MESSAGES.FORM_ACCESS_DENIED,
            code: ERROR_CODES.FORBIDDEN,
          },
        },
        403,
      );
    }

    const result = await authenticateDualForForm(c, formId, requiredScopes);
    if ("error" in result) {
      return result.response;
    }

    try {
      await checkFormPermissionLevel(result.context, formId, requiredRole);
    } catch (error) {
      if (error instanceof FormPermissionError) {
        return c.json(
          {
            error: {
              message: error.message,
              code: error.code,
              details: error.details,
            },
          },
          error.statusCode as 403 | 404,
        );
      }
      throw error;
    }

    c.set("dualAuthContext", result.context);
    return next();
  });
}
