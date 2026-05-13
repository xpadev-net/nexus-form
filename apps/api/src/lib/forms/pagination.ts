/**
 * ページネーション用のインターフェース
 */
export interface PaginationOptions {
  page: number;
  limit: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/**
 * ページネーション結果のインターフェース
 */
export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * ページネーションオプションを検証・正規化
 */
export function validatePaginationOptions(
  options: Partial<PaginationOptions>,
): PaginationOptions {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 10)); // 最大100件まで
  const sortBy = options.sortBy || "createdAt";
  const sortOrder = options.sortOrder || "desc";

  return {
    page,
    limit,
    sortBy,
    sortOrder,
  };
}

/**
 * ページネーション結果を計算
 */
export function calculatePagination(
  total: number,
  page: number,
  limit: number,
): PaginatedResult<unknown>["pagination"] {
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  return {
    page,
    limit,
    total,
    totalPages,
    hasNext,
    hasPrev,
  };
}
