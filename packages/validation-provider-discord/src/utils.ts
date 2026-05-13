interface DiscordError {
  message?: string;
  code?: number;
  status?: number;
}

export function isValidDiscordUserId(userId: string): boolean {
  return /^\d{17,20}$/.test(userId);
}

export function isValidDiscordGuildId(guildId: string): boolean {
  return /^\d{17,20}$/.test(guildId);
}

export function isValidDiscordRoleId(roleId: string): boolean {
  return /^\d{17,20}$/.test(roleId);
}

export function isValidDiscordBotToken(token: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

export function parseDiscordError(
  error: DiscordError | string | unknown,
): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return (error as DiscordError).message || "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown Discord API error";
}

export function isRateLimitError(error: DiscordError): boolean {
  return error?.code === 429 || error?.status === 429;
}

export function getRateLimitRetryAfter(error: unknown): number | null {
  if (error && typeof error === "object" && "retry_after" in error) {
    const retryAfter = (error as { retry_after: number }).retry_after;
    return retryAfter * 1000;
  }
  if (error && typeof error === "object" && "headers" in error) {
    const headers = (error as { headers: Record<string, string> }).headers;
    if (headers["retry-after"]) {
      return parseInt(headers["retry-after"], 10) * 1000;
    }
  }
  return null;
}

export function isAuthenticationError(error: DiscordError): boolean {
  return error?.code === 401 || error?.status === 401;
}

export function isPermissionError(error: DiscordError): boolean {
  return error?.code === 403 || error?.status === 403;
}

export function isNotFoundError(error: DiscordError): boolean {
  return error?.code === 404 || error?.status === 404;
}

export async function isValidBotTokenAsync(token: string): Promise<boolean> {
  if (!isValidDiscordBotToken(token)) {
    return false;
  }
  try {
    const { getSelfApplication } = await import("./requests");
    const { ZDiscordToken } = await import("./types");
    const parsed = ZDiscordToken.parse(token);
    await getSelfApplication(parsed);
    return true;
  } catch {
    return false;
  }
}
