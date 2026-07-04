import { z } from "zod";

/** GET /integrations/google/callback のレスポンス。 */
export const GoogleCallbackResponseSchema = z.object({
  success: z.literal(true),
});
export type GoogleCallbackResponse = z.infer<
  typeof GoogleCallbackResponseSchema
>;

/** Google Drive folder path segment. */
export const DriveFolderPathSegmentSchema = z.object({
  id: z.string(),
  name: z.string(),
});

/** Google Drive folder path for one parent chain. */
export const DriveFolderPathSchema = z.object({
  folderIds: z.array(z.string()),
  pathSegments: z.array(DriveFolderPathSegmentSchema),
});

/** Google スプレッドシート 1 件。 */
export const SpreadsheetItemSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  itemType: z.literal("spreadsheet"),
  parents: z.array(z.string()),
  folderPaths: z.array(DriveFolderPathSchema),
});

/** GET /integrations/google/spreadsheets のレスポンス。 */
export const GoogleSpreadsheetsResponseSchema = z.object({
  spreadsheets: z.array(SpreadsheetItemSchema),
  nextPageToken: z.string().nullish(),
});
export type GoogleSpreadsheetsResponse = z.infer<
  typeof GoogleSpreadsheetsResponseSchema
>;

/** Google シート 1 件。 */
export const SheetItemSchema = z.object({
  sheetId: z.number().int().nullish(),
  title: z.string(),
});

/** GET /integrations/google/spreadsheets/:id/sheets のレスポンス。 */
export const GoogleSheetsResponseSchema = z.object({
  sheets: z.array(SheetItemSchema),
});
export type GoogleSheetsResponse = z.infer<typeof GoogleSheetsResponseSchema>;
