import {
  MAX_RESPONSE_DATA_JSON_BYTES,
  type ResponseDataItem,
} from "@nexus-form/shared";

/**
 * Serializes response data while enforcing the database TEXT column limit.
 *
 * @param responses - Validated response payload items to store on FormResponse.
 * @returns JSON string, or null when the UTF-8 byte length exceeds the limit.
 */
export function stringifyResponseDataJson(
  responses: ResponseDataItem[],
): string | null {
  const responseDataJson = JSON.stringify(responses);
  if (
    Buffer.byteLength(responseDataJson, "utf8") > MAX_RESPONSE_DATA_JSON_BYTES
  ) {
    return null;
  }

  return responseDataJson;
}
