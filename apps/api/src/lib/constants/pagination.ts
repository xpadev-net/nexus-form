import { z } from "zod";

/**
 * ページネーション関連の定数
 */
export const PAGINATION_CONFIG = {
  /** デフォルトのページサイズ */
  DEFAULT_LIMIT: 20,
  /** 最大ページサイズ */
  MAX_LIMIT: 100,
  /** 最小ページサイズ */
  MIN_LIMIT: 1,
  /** デフォルトのページ番号 */
  DEFAULT_PAGE: 1,
} as const;

/** zValidator("query", ...) で使用するページネーションクエリスキーマ */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * ページネーション設定を検証・正規化
 */
export function normalizePaginationParams(params: {
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(
    PAGINATION_CONFIG.DEFAULT_PAGE,
    params.page || PAGINATION_CONFIG.DEFAULT_PAGE,
  );
  const pageSize = Math.min(
    PAGINATION_CONFIG.MAX_LIMIT,
    Math.max(
      PAGINATION_CONFIG.MIN_LIMIT,
      params.pageSize || PAGINATION_CONFIG.DEFAULT_LIMIT,
    ),
  );

  return { page, pageSize };
}

export function paginationMetadata(
  page: number,
  pageSize: number,
  total: number,
) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}
