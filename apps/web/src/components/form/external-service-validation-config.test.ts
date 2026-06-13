import type { ValidationProviderConfigField } from "@nexus-form/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, NetworkError } from "@/lib/fetch-json";
import { shouldRetryQuery } from "@/lib/query-retry";
import { fetchOptions } from "./external-service-validation-config";

const field = {
  name: "roleId",
  label: "Role",
  kind: "select",
  optionSource: {
    endpoint: "/api/validation-providers/discord/roles",
    collectionPath: "data.roles",
    valuePath: "id",
    labelPath: "name",
    colorPath: "color",
  },
} satisfies ValidationProviderConfigField;

async function captureRejection(
  action: () => Promise<unknown>,
): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to reject");
}

function stubFetchFailure(error: unknown) {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(error));
}

function stubFetchResponse(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "Upstream failed" }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("fetchOptions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes raw fetch network TypeError into retryable NetworkError", async () => {
    stubFetchFailure(new TypeError("Failed to fetch"));

    const error = await captureRejection(() =>
      fetchOptions(field, field.optionSource.endpoint, "form-1"),
    );

    expect(error).toBeInstanceOf(NetworkError);
    expect(shouldRetryQuery(0, error)).toBe(true);
  });

  it("normalizes HTTP 5xx responses into retryable HttpError", async () => {
    stubFetchResponse(502);

    const error = await captureRejection(() =>
      fetchOptions(field, field.optionSource.endpoint, "form-1"),
    );

    expect(error).toBeInstanceOf(HttpError);
    expect(shouldRetryQuery(0, error)).toBe(true);
  });

  it("normalizes HTTP 4xx responses into non-retryable HttpError", async () => {
    stubFetchResponse(400);

    const error = await captureRejection(() =>
      fetchOptions(field, field.optionSource.endpoint, "form-1"),
    );

    expect(error).toBeInstanceOf(HttpError);
    expect(shouldRetryQuery(0, error)).toBe(false);
  });

  it("preserves same-origin credentials for dynamic option endpoints", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            roles: [{ id: "role-1", name: "Member", color: 255 }],
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchOptions(field, field.optionSource.endpoint, "form-1"),
    ).resolves.toEqual([{ value: "role-1", label: "Member", color: 255 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining(
          "http://localhost:3001/api/validation-providers/discord/roles",
        ),
      }),
      { credentials: "include" },
    );
  });

  it("preserves omitted credentials for cross-origin dynamic option endpoints", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { roles: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchOptions(
        field,
        "https://options.example.test/discord/roles",
        undefined,
      ),
    ).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), {
      credentials: "omit",
    });
  });
});
