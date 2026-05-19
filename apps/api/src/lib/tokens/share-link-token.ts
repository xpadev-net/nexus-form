import { db } from "@nexus-form/database";
import { apiToken, formShareLink } from "@nexus-form/database/schema";
import {
  type ApiTokenFormIds,
  type ApiTokenScopes,
  parseApiTokenScopes,
  parseStoredApiTokenFormIds,
} from "@nexus-form/shared";
import { eq } from "drizzle-orm";
import { generateSecureToken } from "./generate";
import { computeLookupHash, hashToken } from "./hash";

export type IssuedShareLinkApiToken = {
  token: string;
  apiToken: {
    id: string;
    userId: string | null;
    name: string;
    tokenHash: string;
    scopes: ApiTokenScopes;
    formIds: ApiTokenFormIds | undefined;
    type: string;
    isActive: boolean;
    expiresAt: Date | null;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    shareLinkId: string | null;
    shareLink: {
      id: string;
      formId: string;
      token: string;
      role: string;
      isActive: boolean;
      expiresAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      createdBy: string | null;
    } | null;
  };
};

/**
 * 共有リンクを検証し、リンク情報を取得する
 * NOTE: この関数は将来的に permission-service から移行する可能性がある
 */
async function validateShareLinkInternal(shareLinkToken: string) {
  const [link] = await db
    .select()
    .from(formShareLink)
    .where(eq(formShareLink.token, shareLinkToken))
    .limit(1);

  if (!link) {
    throw new Error("Share link not found");
  }

  if (!link.isActive) {
    throw new Error("Share link is not active");
  }

  if (link.expiresAt && link.expiresAt <= new Date()) {
    throw new Error("Share link has expired");
  }

  return {
    share_link: {
      id: link.id,
      expires_at: link.expiresAt?.toISOString() ?? null,
    },
    role: link.role as "EDITOR" | "VIEWER",
    form: {
      id: link.formId,
      title: "Untitled", // タイトルはformテーブルから別途取得が必要
    },
  };
}

/**
 * 共有リンク用のAPIトークンを発行する
 * - 共有リンクの有効性と対象フォームを検証
 * - 新規にSHARE_LINKタイプのトークンを作成し、プレーンテキストを返却
 */
export async function createApiTokenForShareLink(
  shareLinkToken: string,
  formId: string,
): Promise<IssuedShareLinkApiToken> {
  // 共有リンクの検証と情報取得
  const shareLinkResult = await validateShareLinkInternal(shareLinkToken);

  // フォームIDの整合性チェック
  if (shareLinkResult.form.id !== formId) {
    throw new Error("Share link does not match the specified form");
  }

  const shareLinkId = shareLinkResult.share_link.id;
  const role = shareLinkResult.role;
  const formTitle = shareLinkResult.form.title ?? "Untitled";

  // スコープの決定（VIEWER: read のみ / EDITOR: read, write）
  const scopes = parseApiTokenScopes(
    role === "EDITOR" ? ["read", "write"] : ["read"],
  );
  const formIds = parseStoredApiTokenFormIds([formId]);

  // プレーンテキストトークン生成とハッシュ化
  const plainToken = generateSecureToken();
  const tokenHash = await hashToken(plainToken);
  const lookupHash = computeLookupHash(plainToken);

  // 有効期限の同期（共有リンクが期限なしならundefinedのまま）
  const expiresAt = shareLinkResult.share_link.expires_at
    ? new Date(shareLinkResult.share_link.expires_at)
    : undefined;

  // レコード作成
  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(apiToken).values({
    id,
    userId: null,
    name: `Share Link: ${formTitle}`,
    tokenHash,
    lookupHash,
    scopes,
    formIds,
    type: "SHARE_LINK",
    shareLinkId,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  // 作成したトークンを取得
  const [createdToken] = await db
    .select()
    .from(apiToken)
    .where(eq(apiToken.id, id))
    .limit(1);

  if (!createdToken) {
    throw new Error("Failed to create API token for share link");
  }

  // 共有リンク情報を取得
  const [shareLink] = await db
    .select()
    .from(formShareLink)
    .where(eq(formShareLink.id, shareLinkId))
    .limit(1);

  return {
    token: plainToken,
    apiToken: {
      ...createdToken,
      type: createdToken.type as string,
      scopes,
      formIds,
      shareLink: shareLink ?? null,
    },
  };
}
