import { randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import { formIntegration } from "@nexus-form/database/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

/**
 * Google Sheets integration setting schema
 */
export const GoogleSheetsIntegrationSettingSchema = z.object({
  spreadsheetId: z.string().min(1, "スプレッドシートIDは必須です"),
  sheetName: z.string().min(1, "シート名は必須です"),
  headerPolicy: z.literal("extend"),
});

export type GoogleSheetsIntegrationSetting = z.infer<
  typeof GoogleSheetsIntegrationSettingSchema
>;

export interface FormIntegrationRecord {
  id: string;
  formId: string;
  ownerUserId: string;
  userId: string | null;
  config: GoogleSheetsIntegrationSetting;
  createdAt: Date;
  updatedAt: Date;
}

function parseConfig(configJson: string): GoogleSheetsIntegrationSetting {
  const parsed = GoogleSheetsIntegrationSettingSchema.safeParse(
    JSON.parse(configJson),
  );
  if (!parsed.success) {
    throw new Error("Stored Google Sheets integration config is invalid");
  }
  return parsed.data;
}

export async function getFormIntegration(
  formId: string,
): Promise<FormIntegrationRecord | null> {
  const [record] = await db
    .select()
    .from(formIntegration)
    .where(eq(formIntegration.formId, formId))
    .limit(1);

  if (!record) return null;

  return {
    id: record.id,
    formId: record.formId,
    ownerUserId: record.ownerUserId,
    userId: record.userId,
    config: parseConfig(record.configJson),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function upsertFormIntegration(params: {
  formId: string;
  ownerUserId: string;
  userId?: string | null;
  config: GoogleSheetsIntegrationSetting;
}): Promise<FormIntegrationRecord> {
  const [existing] = await db
    .select()
    .from(formIntegration)
    .where(eq(formIntegration.formId, params.formId))
    .limit(1);

  const ownerUserIdToUse =
    existing && existing.ownerUserId !== params.ownerUserId
      ? params.ownerUserId
      : (existing?.ownerUserId ?? params.ownerUserId);

  const userIdToUse =
    existing && existing.userId !== params.userId
      ? (params.userId ?? params.ownerUserId)
      : (existing?.userId ?? params.userId ?? params.ownerUserId);

  if (existing) {
    // Update existing record
    await db
      .update(formIntegration)
      .set({
        ownerUserId: ownerUserIdToUse,
        userId: userIdToUse ?? null,
        configJson: JSON.stringify(params.config),
      })
      .where(eq(formIntegration.formId, params.formId));
  } else {
    // Insert new record
    await db.insert(formIntegration).values({
      id: randomUUID(),
      formId: params.formId,
      ownerUserId: ownerUserIdToUse,
      userId: userIdToUse ?? null,
      configJson: JSON.stringify(params.config),
    });
  }

  // Fetch the upserted record
  const [record] = await db
    .select()
    .from(formIntegration)
    .where(eq(formIntegration.formId, params.formId))
    .limit(1);

  if (!record) {
    throw new Error("Failed to upsert form integration");
  }

  return {
    id: record.id,
    formId: record.formId,
    ownerUserId: record.ownerUserId,
    userId: record.userId,
    config: params.config,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function deleteFormIntegration(formId: string): Promise<boolean> {
  const [record] = await db
    .select({ id: formIntegration.id })
    .from(formIntegration)
    .where(eq(formIntegration.formId, formId))
    .limit(1);

  if (!record) return false;

  await db.delete(formIntegration).where(eq(formIntegration.formId, formId));

  return true;
}
