import { z } from "zod";

/**
 * Google Sheets integration configuration for a form
 */
export const HeaderPolicySchema = z.enum(["extend"]).default("extend");

export const FormGoogleSheetsConfigSchema = z.object({
  formId: z.string().min(1),
  spreadsheetId: z.string().min(1),
  sheetName: z.string().min(1),
  enabled: z.boolean().default(false),
  headerPolicy: HeaderPolicySchema,
});

export type FormGoogleSheetsConfig = z.infer<
  typeof FormGoogleSheetsConfigSchema
>;
