export class HttpError extends Error {
  status: number;
  body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const parseResponseBody = async (
  response: Response,
): Promise<unknown | undefined> => {
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return response.json();
  }
  if (contentType?.startsWith("text/")) {
    return response.text();
  }
  return undefined;
};

export async function fetchJson<T = undefined>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<T> {
  const { credentials = "same-origin", ...restInit } = init ?? {};
  const response = await fetch(input, {
    ...restInit,
    credentials,
  });

  if (!response.ok) {
    const body = await parseResponseBody(response).catch(() => undefined);
    const fallbackMessage = `Request failed with status ${response.status}`;
    const messageFromBody =
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof (body as { message?: string }).message === "string"
        ? (body as { message?: string }).message
        : undefined;
    throw new HttpError(
      response.status,
      messageFromBody ?? fallbackMessage,
      body,
    );
  }

  if (response.status === 204) {
    return undefined as T & undefined;
  }

  return (await parseResponseBody(response)) as T;
}
