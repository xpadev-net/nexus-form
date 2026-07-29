import { describe, expect, it, vi } from "vitest";
import { addJobWithCleanup } from "../job-queue-utils";

describe("addJobWithCleanup", () => {
  it("returns delayed-job-state-changed for BullMQ numeric JobNotInState errors", async () => {
    const changeDelay = vi.fn(async () => {
      throw Object.assign(new Error("state changed"), { code: -3 });
    });
    const getState = vi
      .fn()
      .mockResolvedValueOnce("delayed")
      .mockResolvedValueOnce("waiting");
    const queue = {
      getJob: vi.fn(async () => ({
        changeDelay,
        getState,
        remove: vi.fn(async () => undefined),
      })),
      add: vi.fn(async () => undefined),
    };

    await expect(
      addJobWithCleanup(queue, {
        delay: 10_000,
        jobData: { formId: "form-1" },
        jobId: "response-link-analysis.form-1",
        jobName: "response-submitted",
      }),
    ).resolves.toEqual({ outcome: "delayed-job-state-changed" });
    expect(queue.add).not.toHaveBeenCalled();
  });
});
