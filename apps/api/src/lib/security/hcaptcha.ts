import { z } from "zod";

/**
 * hCaptcha APIレスポンススキーマ
 */
const HCaptchaResponseSchema = z.object({
  success: z.boolean(),
  challenge_ts: z.string().optional(),
  hostname: z.string().optional(),
  credit: z.boolean().optional(),
  "error-codes": z.array(z.string()).optional(),
  score: z.number().optional(),
  score_reason: z.array(z.string()).optional(),
});

/**
 * hCaptcha検証設定
 */
export interface HCaptchaVerifyOptions {
  /** タイムアウト時間（ミリ秒）デフォルト: 5000 */
  timeout?: number;
  /** リトライ回数 デフォルト: 3 */
  maxRetries?: number;
  /** スコア閾値 デフォルト: 0.5 */
  scoreThreshold?: number;
  /** リモートIPアドレス（オプション） */
  remoteip?: string;
  /** サイトキー（オプション） */
  sitekey?: string;
}

/**
 * hCaptcha検証結果
 */
export interface HCaptchaVerifyResult {
  /** 検証成功フラグ */
  success: boolean;
  /** スコア（Enterprise版の場合） */
  score?: number;
  /** エラーコード */
  errorCodes?: string[];
  /** エラーメッセージ */
  errorMessage?: string;
}

/**
 * hCaptcha検証エラー
 */
export class HCaptchaVerificationError extends Error {
  constructor(
    message: string,
    public readonly errorCodes?: string[],
  ) {
    super(message);
    this.name = "HCaptchaVerificationError";
  }
}

/**
 * hCaptchaシークレットキーを取得
 */
function getSecretKey(): string {
  const secretKey = process.env.HCAPTCHA_SECRET_KEY;
  if (!secretKey) {
    throw new HCaptchaVerificationError(
      "HCAPTCHA_SECRET_KEY is not configured in environment variables",
    );
  }
  return secretKey;
}

/**
 * hCaptcha APIにリクエストを送信（リトライロジック付き）
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number,
  timeout: number,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 最後のリトライでない場合は待機
      if (attempt < maxRetries) {
        // エクスポネンシャルバックオフ: 100ms, 200ms, 400ms...
        const delay = 100 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new HCaptchaVerificationError(
    `Failed to verify hCaptcha token after ${maxRetries + 1} attempts: ${lastError?.message}`,
  );
}

/**
 * hCaptchaトークンを検証
 *
 * @param token - hCaptchaから取得したトークン
 * @param options - 検証オプション
 * @returns 検証結果
 *
 * @throws {HCaptchaVerificationError} 検証に失敗した場合
 *
 * @example
 * ```typescript
 * const result = await verifyHCaptchaToken(token, {
 *   scoreThreshold: 0.7,
 *   remoteip: '192.168.1.1'
 * });
 *
 * if (!result.success) {
 *   logError('Verification failed:', "ui", { error: result.errorMessage });
 * }
 * ```
 */
export async function verifyHCaptchaToken(
  token: string,
  options: HCaptchaVerifyOptions = {},
): Promise<HCaptchaVerifyResult> {
  const {
    timeout = 5000,
    maxRetries = 3,
    scoreThreshold = 0.5,
    remoteip,
    sitekey,
  } = options;

  // トークンの基本検証
  if (!token || typeof token !== "string" || token.trim() === "") {
    return {
      success: false,
      errorMessage: "Invalid token: token must be a non-empty string",
    };
  }

  try {
    const secretKey = getSecretKey();

    // リクエストボディを構築
    const params = new URLSearchParams({
      secret: secretKey,
      response: token,
    });

    if (remoteip) {
      params.append("remoteip", remoteip);
    }

    if (sitekey) {
      params.append("sitekey", sitekey);
    }

    // hCaptcha APIにリクエスト
    const response = await fetchWithRetry(
      "https://api.hcaptcha.com/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      },
      maxRetries,
      timeout,
    );

    if (!response.ok) {
      throw new HCaptchaVerificationError(
        `hCaptcha API returned status ${response.status}`,
      );
    }

    // レスポンスをパース
    const data = await response.json();

    // スキーマ検証
    const validatedData = HCaptchaResponseSchema.parse(data);

    // 検証失敗の場合
    if (!validatedData.success) {
      return {
        success: false,
        errorCodes: validatedData["error-codes"],
        errorMessage: `hCaptcha verification failed: ${validatedData["error-codes"]?.join(", ") || "Unknown error"}`,
      };
    }

    // スコア検証（Enterprise版の場合）
    if (validatedData.score !== undefined) {
      const scorePass = validatedData.score >= scoreThreshold;
      if (!scorePass) {
        return {
          success: false,
          score: validatedData.score,
          errorMessage: `hCaptcha score ${validatedData.score} is below threshold ${scoreThreshold}`,
        };
      }
    }

    return {
      success: true,
      score: validatedData.score,
    };
  } catch (error) {
    if (error instanceof HCaptchaVerificationError) {
      throw error;
    }

    if (error instanceof z.ZodError) {
      throw new HCaptchaVerificationError(
        `Invalid hCaptcha API response: ${error.message}`,
      );
    }

    throw new HCaptchaVerificationError(
      `Unexpected error during hCaptcha verification: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * hCaptchaトークンを検証（シンプル版、boolean返却）
 *
 * @param token - hCaptchaから取得したトークン
 * @param options - 検証オプション
 * @returns 検証成功の場合true、失敗の場合false
 *
 * @example
 * ```typescript
 * if (await verifyHCaptcha(token)) {
 *   // 検証成功
 * }
 * ```
 */
export async function verifyHCaptcha(
  token: string,
  options?: HCaptchaVerifyOptions,
): Promise<boolean> {
  try {
    const result = await verifyHCaptchaToken(token, options);
    return result.success;
  } catch {
    return false;
  }
}
