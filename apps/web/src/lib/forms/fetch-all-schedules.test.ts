// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();

vi.mock("@/lib/api", () => ({
  client: {
    api: {
      forms: {
        ":id": {
          schedule: {
            $get: vi.fn(),
          },
        },
      },
    },
  },
  rpc: (responseFn: Promise<unknown>) => rpcMock(responseFn),
}));

const { fetchAllSchedules } = await import("./fetch-all-schedules");

describe("fetchAllSchedules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let callCount = 0;
    rpcMock.mockImplementation(async () => {
      callCount += 1;
      if (callCount > 1) {
        throw new DOMException("Aborted", "AbortError");
      }
      return {
        schedules: [{ id: "schedule-1" }],
        pagination: { totalPages: 3, page: 1, pageSize: 100, total: 3 },
      };
    });
  });

  it("stops paginating when the abort signal is triggered", async () => {
    const controller = new AbortController();
    const promise = fetchAllSchedules("form-1", controller.signal);
    controller.abort(new DOMException("Aborted", "AbortError"));

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("aggregates schedules across all pages", async () => {
    rpcMock.mockImplementation(async () => {
      const page = rpcMock.mock.calls.length;
      return {
        schedules: [{ id: `schedule-${page}` }],
        pagination: { totalPages: 2, page, pageSize: 100, total: 2 },
      };
    });

    const result = await fetchAllSchedules("form-1");

    expect(result.schedules).toEqual([
      { id: "schedule-1" },
      { id: "schedule-2" },
    ]);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});
