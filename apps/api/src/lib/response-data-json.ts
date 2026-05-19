import {
  MAX_RESPONSE_DATA_JSON_BYTES,
  type ResponseDataItem,
} from "@nexus-form/shared";

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
