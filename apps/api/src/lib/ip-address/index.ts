import { extractIPByStrategy } from "./strategies";
import type { IPExtractionOptions, IPExtractionResult } from "./types";

/**
 * クライアントIPアドレスを抽出
 * @param request Requestオブジェクトまたはheadersを持つオブジェクト
 * @param options 抽出オプション（戦略を指定）
 * @returns IPアドレスと取得元の情報
 */
export function extractClientIP(
  request: Request | { headers: Headers },
  options: IPExtractionOptions,
): IPExtractionResult {
  return extractIPByStrategy(request, options.strategy);
}
