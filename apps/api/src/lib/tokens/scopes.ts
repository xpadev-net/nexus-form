import type { TokenScope } from "../../types/api/auth";

/**
 * スコープの階層関係を定義
 * 上位スコープは下位スコープの権限も含む
 */
export const SCOPE_HIERARCHY: Record<TokenScope, TokenScope[]> = {
  read: ["read"],
  write: ["read", "write"],
  admin: ["read", "write", "admin"],
};

/**
 * スコープが指定された権限を含んでいるかチェックする
 */
export function hasRequiredScopes(
  userScopes: TokenScope[],
  requiredScopes: TokenScope[],
): boolean {
  return requiredScopes.every((requiredScope) =>
    userScopes.some((userScope) =>
      SCOPE_HIERARCHY[userScope]?.includes(requiredScope),
    ),
  );
}

/**
 * スコープの説明を取得する
 */
export function getScopeDescription(scope: TokenScope): string {
  const descriptions: Record<TokenScope, string> = {
    read: "データの読み取り",
    write: "データの読み取り・作成・更新",
    admin: "全ての操作（読み取り・作成・更新・削除・管理）",
  };

  return descriptions[scope];
}

/**
 * 全てのスコープを取得する
 */
export function getAllScopes(): TokenScope[] {
  return ["read", "write", "admin"];
}

/**
 * スコープの優先度を取得する
 */
export function getScopePriority(scope: TokenScope): number {
  const priorities: Record<TokenScope, number> = {
    read: 1,
    write: 2,
    admin: 3,
  };

  return priorities[scope];
}

/**
 * スコープを優先度順にソートする
 */
export function sortScopesByPriority(scopes: TokenScope[]): TokenScope[] {
  return [...scopes].sort((a, b) => getScopePriority(b) - getScopePriority(a));
}
