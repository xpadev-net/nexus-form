import { z } from "zod";

/** ページネーションメタ情報のレスポンススキーマ。 */
export const PaginationSchema = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});
export type Pagination = z.infer<typeof PaginationSchema>;
