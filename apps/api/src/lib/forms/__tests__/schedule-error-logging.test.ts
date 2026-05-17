import { describe, expect, it, vi } from "vitest";
import { logFormScheduleError } from "../schedule-error-logging";

vi.mock("../../logger", () => ({
  logError: vi.fn(),
}));

vi.mock("../../sentry", () => ({
  captureError: vi.fn(),
}));

describe("logFormScheduleError", () => {
  it("logs schedule processing failures and forwards them to Sentry", async () => {
    const { logError } = await import("../../logger");
    const { captureError } = await import("../../sentry");
    const error = new Error("schedule update failed");

    const result = logFormScheduleError(error, {
      formId: "form-1",
      publicId: "public-1",
      operation: "POST /public/:publicId/submit",
    });

    expect(result).toBeNull();
    expect(logError).toHaveBeenCalledWith(
      "Failed to process form schedule",
      "forms-schedule",
      {
        formId: "form-1",
        publicId: "public-1",
        operation: "POST /public/:publicId/submit",
        error,
      },
    );
    expect(captureError).toHaveBeenCalledWith(error);
  });
});
