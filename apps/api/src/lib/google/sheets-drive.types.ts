import { z } from "zod";

// ----- Error types??? Result????? -----

export const GoogleApiErrorCodeSchema = z.union([
  z.literal("rateLimit"),
  z.literal("unauthorized"),
  z.literal("forbidden"),
  z.literal("notFound"),
  z.literal("invalidArgument"),
  z.literal("internal"),
  z.literal("unknown"),
]);
export type GoogleApiErrorCode = z.infer<typeof GoogleApiErrorCodeSchema>;
export const GoogleApiErrorSchema = z.object({
  code: GoogleApiErrorCodeSchema,
  message: z.string(),
  retryAfterSeconds: z.number().int().positive().optional(),
  cause: z.unknown().optional(),
});
export type GoogleApiError = z.infer<typeof GoogleApiErrorSchema>;
export type Result<TData> =
  | { ok: true; data: TData }
  | { ok: false; error: GoogleApiError };

// ----------- Google Sheets API types -------------
// append/values API
export const AppendRowsGoogleApiResponseSchema = z.object({
  spreadsheetId: z.string(),
  tableRange: z.string().optional(),
  updates: z.object({
    spreadsheetId: z.string(),
    updatedRange: z.string(),
    updatedRows: z.number().optional(),
    updatedColumns: z.number().optional(),
    updatedCells: z.number().optional(),
    updatedData: z
      .object({
        range: z.string(),
        majorDimension: z.enum(["ROWS", "COLUMNS"]),
        values: z.array(z.array(z.string())),
      })
      .optional(),
  }),
});
export type AppendRowsGoogleApiResponse = z.infer<
  typeof AppendRowsGoogleApiResponseSchema
>;

export const ReadRangeGoogleApiResponseSchema = z.object({
  range: z.string(),
  majorDimension: z.enum(["ROWS", "COLUMNS"]),
  values: z.array(z.array(z.string())).optional(),
});
export type ReadRangeGoogleApiResponse = z.infer<
  typeof ReadRangeGoogleApiResponseSchema
>;

export const UpdateRangeGoogleApiResponseSchema = z.object({
  spreadsheetId: z.string().optional(),
  updatedRange: z.string().optional(),
  updatedRows: z.number().optional(),
  updatedColumns: z.number().optional(),
  updatedCells: z.number().optional(),
  updatedData: z
    .object({
      range: z.string(),
      majorDimension: z.enum(["ROWS", "COLUMNS"]),
      values: z.array(z.array(z.string())),
    })
    .optional(),
});
export type UpdateRangeGoogleApiResponse = z.infer<
  typeof UpdateRangeGoogleApiResponseSchema
>;

export const SpreadsheetMetadataGoogleResponseSchema = z.object({
  sheets: z.array(
    z.object({
      properties: z.object({
        sheetId: z.number(),
        title: z.string(),
      }),
    }),
  ),
});
export type SpreadsheetMetadataGoogleResponse = z.infer<
  typeof SpreadsheetMetadataGoogleResponseSchema
>;

// AppendRowsInput/Output/ReadRangeInput/Output????
export const AppendRowsInputSchema = z.object({
  spreadsheetId: z.string().min(1),
  sheetName: z.string().min(1),
  rows: z.array(z.array(z.string())),
  insertOption: z.enum(["INSERT_ROWS", "OVERWRITE"]).optional(),
});
export type AppendRowsInput = z.infer<typeof AppendRowsInputSchema>;
export const AppendRowsOutputSchema = z.object({
  updatedRange: z.string().min(1),
  updatedRows: z.number().int().nonnegative(),
});
export type AppendRowsOutput = z.infer<typeof AppendRowsOutputSchema>;

export const ReadRangeInputSchema = z.object({
  spreadsheetId: z.string().min(1),
  rangeA1: z.string().min(1),
  majorDimension: z.enum(["ROWS", "COLUMNS"]).default("ROWS").optional(),
});
export type ReadRangeInput = z.infer<typeof ReadRangeInputSchema>;
export const ReadRangeOutputSchema = z.object({
  values: z.array(z.array(z.string())).default([]),
  range: z.string().min(1),
  majorDimension: z.enum(["ROWS", "COLUMNS"]).default("ROWS"),
});
export type ReadRangeOutput = z.infer<typeof ReadRangeOutputSchema>;

// --- Listing helpers used by API routes
export const ListSpreadsheetsInputSchema = z.object({
  query: z.string().optional(),
  pageSize: z.number().int().positive().optional(),
  pageToken: z.string().optional(),
});
export type ListSpreadsheetsInput = z.infer<typeof ListSpreadsheetsInputSchema>;

export const ListSpreadsheetsOutputSchema = z.object({
  spreadsheets: z.array(
    z.object({ id: z.string(), name: z.string().optional() }),
  ),
  nextPageToken: z.string().optional(),
});
export type ListSpreadsheetsOutput = z.infer<
  typeof ListSpreadsheetsOutputSchema
>;

export const ListSheetsInputSchema = z.object({
  spreadsheetId: z.string().min(1),
});
export type ListSheetsInput = z.infer<typeof ListSheetsInputSchema>;

export const ListSheetsOutputSchema = z.object({
  sheets: z.array(
    z.object({ sheetId: z.number().optional(), title: z.string() }),
  ),
});
export type ListSheetsOutput = z.infer<typeof ListSheetsOutputSchema>;

export const CreateSpreadsheetInputSchema = z.object({
  title: z.string().min(1).max(128),
});
export type CreateSpreadsheetInput = z.infer<
  typeof CreateSpreadsheetInputSchema
>;

export const CreateSpreadsheetGoogleResponseSchema = z.object({
  spreadsheetId: z.string(),
  properties: z
    .object({
      title: z.string().optional(),
    })
    .optional(),
  spreadsheetUrl: z.string().url().optional(),
  sheets: z
    .array(
      z.object({
        properties: z
          .object({
            sheetId: z.number().optional(),
            title: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export const CreateSpreadsheetOutputSchema = z.object({
  spreadsheetId: z.string().min(1),
  title: z.string().min(1),
  spreadsheetUrl: z.string().url().optional(),
  defaultSheetTitle: z.string().optional(),
});
export type CreateSpreadsheetOutput = z.infer<
  typeof CreateSpreadsheetOutputSchema
>;

export const AddSheetInputSchema = z.object({
  title: z.string().min(1).max(128),
});
export type AddSheetInput = z.infer<typeof AddSheetInputSchema>;

export const AddSheetGoogleResponseSchema = z.object({
  replies: z
    .array(
      z.object({
        addSheet: z
          .object({
            properties: z.object({
              sheetId: z.number().optional(),
              title: z.string().optional(),
            }),
          })
          .optional(),
      }),
    )
    .optional(),
});

export const AddSheetOutputSchema = z.object({
  sheetId: z.number().optional(),
  title: z.string().min(1),
});
export type AddSheetOutput = z.infer<typeof AddSheetOutputSchema>;

// Update (set) values for a given A1 range
export const UpdateRangeInputSchema = z.object({
  spreadsheetId: z.string().min(1),
  rangeA1: z.string().min(1),
  values: z.array(z.array(z.string())),
});
export type UpdateRangeInput = z.infer<typeof UpdateRangeInputSchema>;
export const UpdateRangeOutputSchema = z.object({
  updatedRange: z.string().min(1),
  updatedRows: z.number().int().nonnegative().optional(),
});
export type UpdateRangeOutput = z.infer<typeof UpdateRangeOutputSchema>;

// BatchUpdate minimal response shape (we only need to know it succeeded)
export const BatchUpdateResponseSchema = z.object({
  spreadsheetId: z.string(),
  replies: z.array(z.unknown()).optional(),
});
export type BatchUpdateResponse = z.infer<typeof BatchUpdateResponseSchema>;

// ---- ??????????????????????? ----
