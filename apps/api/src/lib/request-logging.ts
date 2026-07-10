import type { MiddlewareHandler } from "hono";

const REQUEST_TARGET_BASE_URL = "http://request-target.invalid";

export const INVALID_REQUEST_TARGET = "[INVALID_REQUEST_TARGET]";
const REDACTED_REQUEST_TARGET_SEGMENT = "[REDACTED]";

type PrintFunc = (message: string, ...rest: string[]) => void;

const CREDENTIAL_ROUTE_SEGMENTS = new Set([
  "code",
  "state",
  "sharetoken",
  "share-token",
  "share_token",
  "invite",
  "invites",
  "invitation",
  "invitations",
  "share",
  "share-link",
  "share-links",
  "shared",
  "shared-link",
  "shared-links",
]);

const ABSOLUTE_HTTP_URL = /^https?:\/\//i;
const MALFORMED_PERCENT_ENCODING = /%(?![0-9a-f]{2})/i;

function formatElapsedTime(start: number): string {
  const elapsed = Date.now() - start;
  return elapsed < 1_000 ? `${elapsed}ms` : `${Math.round(elapsed / 1_000)}s`;
}

function logRequest(
  fn: PrintFunc,
  prefix: "<--" | "-->",
  method: string,
  requestTarget: string,
  status?: number,
  elapsed?: string,
): void {
  const message =
    prefix === "<--"
      ? `${prefix} ${method} ${requestTarget}`
      : `${prefix} ${method} ${requestTarget} ${status} ${elapsed}`;
  fn(message);
}

/**
 * Log request start and completion without exposing the raw request target.
 * The target is sanitized once so both entries describe the same request.
 */
export function requestLogger(fn: PrintFunc = console.log): MiddlewareHandler {
  return async (c, next) => {
    const { method, url } = c.req;
    const requestTarget = sanitizeRequestTarget(url);

    logRequest(fn, "<--", method, requestTarget);
    const start = Date.now();
    await next();
    logRequest(
      fn,
      "-->",
      method,
      requestTarget,
      c.res.status,
      formatElapsedTime(start),
    );
  };
}

function containsInvalidRequestTargetCharacters(
  requestTarget: string,
): boolean {
  for (const character of requestTarget) {
    const codePoint = character.charCodeAt(0);
    if (codePoint <= 0x1f || codePoint === 0x7f || character === "\\") {
      return true;
    }
  }
  return false;
}

function getRawPath(requestTarget: string): string | undefined {
  const pathStart = requestTarget.startsWith("/")
    ? 0
    : requestTarget.indexOf("/", requestTarget.indexOf("://") + 3);
  if (pathStart < 0) {
    return undefined;
  }

  return requestTarget.slice(pathStart).split(/[?#]/, 1)[0];
}

function containsAmbiguousDecodedPathSyntax(segment: string): boolean {
  let decodedSegment = segment;
  let hasDecodedEncoding = false;
  for (let pass = 0; pass < 8; pass += 1) {
    const nextSegment = decodeURIComponent(decodedSegment);
    if (
      containsInvalidRequestTargetCharacters(nextSegment) ||
      nextSegment.includes("/") ||
      nextSegment.includes(";") ||
      [".", ".."].includes(nextSegment)
    ) {
      return true;
    }
    if (nextSegment === decodedSegment) {
      return false;
    }
    if (hasDecodedEncoding) {
      return true;
    }
    hasDecodedEncoding = true;
    decodedSegment = nextSegment;
  }
  return true;
}

function containsAmbiguousPathSyntax(requestTarget: string): boolean {
  const rawPath = getRawPath(requestTarget);
  if (rawPath === undefined) {
    return false;
  }

  try {
    return rawPath.split("/").some(containsAmbiguousDecodedPathSyntax);
  } catch {
    return true;
  }
}

function isValidRequestTargetInput(requestTarget: string): boolean {
  return (
    requestTarget.length > 0 &&
    requestTarget === requestTarget.trim() &&
    !containsInvalidRequestTargetCharacters(requestTarget) &&
    !MALFORMED_PERCENT_ENCODING.test(requestTarget) &&
    !containsAmbiguousPathSyntax(requestTarget) &&
    (requestTarget.startsWith("/") || ABSOLUTE_HTTP_URL.test(requestTarget)) &&
    !requestTarget.startsWith("//")
  );
}

/**
 * Return only a diagnosable, credential-free representation of a request target.
 *
 * Relative request paths and absolute HTTP(S) URLs are accepted. The URL parser
 * removes query strings and fragments, while known token-bearing route segments
 * are replaced with a fixed marker. Any ambiguous or malformed input fails closed.
 */
export function sanitizeRequestTarget(requestTarget: string): string {
  if (
    typeof requestTarget !== "string" ||
    !isValidRequestTargetInput(requestTarget)
  ) {
    return INVALID_REQUEST_TARGET;
  }

  let url: URL;
  try {
    url = ABSOLUTE_HTTP_URL.test(requestTarget)
      ? new URL(requestTarget)
      : new URL(requestTarget, REQUEST_TARGET_BASE_URL);
  } catch {
    return INVALID_REQUEST_TARGET;
  }

  const rawSegments = url.pathname.split("/");
  const decodedSegments: string[] = [];
  try {
    for (const segment of rawSegments) {
      const decodedSegment = decodeURIComponent(segment);
      if (
        containsInvalidRequestTargetCharacters(decodedSegment) ||
        decodedSegment.includes("/")
      ) {
        return INVALID_REQUEST_TARGET;
      }
      decodedSegments.push(decodedSegment);
    }
  } catch {
    return INVALID_REQUEST_TARGET;
  }

  const sanitizedSegments = [...rawSegments];
  for (let index = 0; index < decodedSegments.length - 1; index += 1) {
    const decodedSegment = decodedSegments[index];
    const nextRawSegment = rawSegments[index + 1];
    if (decodedSegment === undefined || nextRawSegment === undefined) {
      continue;
    }
    const routeSegment = decodedSegment.toLowerCase();
    if (
      CREDENTIAL_ROUTE_SEGMENTS.has(routeSegment) &&
      nextRawSegment.length > 0
    ) {
      sanitizedSegments[index + 1] = REDACTED_REQUEST_TARGET_SEGMENT;
    }
  }

  return sanitizedSegments.join("/") || "/";
}
