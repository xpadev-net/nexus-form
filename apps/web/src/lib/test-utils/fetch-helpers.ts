import { vi } from "vitest";

export async function captureRejection(
  action: () => Promise<unknown>,
): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  throw new Error("Expected action to reject");
}

export function stubFetchFailure(error: unknown) {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(error));
}

export function stubFetchResponse(status: number) {
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
