import { z } from "zod";
import { ResponseData } from "../../types/domain/response";
import { logError, logWarn } from "../logger";

const ResponseDataArraySchema = z.array(ResponseData);
type ResponseDataArray = z.infer<typeof ResponseDataArraySchema>;

/**
 * フォーム回答データから参照先ブロックの値を取得する
 */
export function getReferencedValueFromResponse(
  responseDataJson: string,
  referencedBlockId: string,
): string | null {
  try {
    const parsedData = JSON.parse(responseDataJson);

    if (!Array.isArray(parsedData)) {
      logWarn("Response data is not an array", "api", { referencedBlockId });
      return null;
    }

    const validationResult = ResponseDataArraySchema.safeParse(parsedData);

    if (!validationResult.success) {
      logWarn("Response data schema mismatch", "api", {
        referencedBlockId,
        issues: validationResult.error.issues,
      });
      return null;
    }

    const responseData: ResponseDataArray = validationResult.data;

    const referencedResponse = responseData.find(
      (r) => r.question_id === referencedBlockId,
    );

    if (!referencedResponse) {
      logWarn(
        `Referenced block ${referencedBlockId} not found in responses`,
        "api",
        {},
      );
      return null;
    }

    if ("value" in referencedResponse) {
      return String(referencedResponse.value);
    }

    if (
      "values" in referencedResponse &&
      Array.isArray(referencedResponse.values)
    ) {
      return referencedResponse.values.length > 0
        ? String(referencedResponse.values[0])
        : "";
    }

    logWarn(
      `Referenced block ${referencedBlockId} has unsupported response type for external validation`,
      "api",
      {},
    );
    return null;
  } catch (error) {
    logError("Failed to parse response data JSON", "api", { error });
    return null;
  }
}
