interface RedisKeyCleanupClient {
  scan(
    cursor: string,
    matchKeyword: "MATCH",
    pattern: string,
    countKeyword: "COUNT",
    count: number,
  ): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
}

const DEFAULT_SCAN_COUNT = 500;

export async function deleteRedisKeysByPattern(
  redis: RedisKeyCleanupClient,
  pattern: string,
  scanCount = DEFAULT_SCAN_COUNT,
): Promise<number> {
  let cursor = "0";
  let deleted = 0;
  const count = Math.max(1, Math.floor(scanCount));

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      count,
    );
    cursor = nextCursor;

    if (keys.length > 0) {
      deleted += await redis.del(...keys);
    }
  } while (cursor !== "0");

  return deleted;
}
