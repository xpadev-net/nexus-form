import { logError } from "../logger";
import { captureError } from "../sentry";

interface ScheduleErrorContext {
  formId: string;
  operation: string;
  publicId?: string;
}

export function logFormScheduleError(
  error: unknown,
  context: ScheduleErrorContext,
): null {
  logError("Failed to process form schedule", "forms-schedule", {
    ...context,
    error,
  });
  captureError(error);
  return null;
}
