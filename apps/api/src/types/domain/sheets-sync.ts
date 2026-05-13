import { z } from "zod";

export const SheetsSyncJobDataSchema = z.object({
  responseId: z.string(),
  formId: z.string(),
});

export type SheetsSyncJobData = z.infer<typeof SheetsSyncJobDataSchema>;
