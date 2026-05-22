import { extractIPByStrategy } from "./strategies";
import type {
  IPAddressRequestLike,
  IPExtractionOptions,
  IPExtractionResult,
} from "./types";

/**
 * クライアントIPアドレスを抽出
 * @param request Requestオブジェクトまたはheadersを持つオブジェクト
 * @param options 抽出オプション（戦略を指定）
 * @returns IPアドレスと取得元の情報
 */
export function extractClientIP(
  request: Request | IPAddressRequestLike,
  options: IPExtractionOptions,
): IPExtractionResult {
  return extractIPByStrategy(
    request,
    options.strategy,
    options.trustedProxyCount,
  );
}
