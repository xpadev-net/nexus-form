import { randomUUID } from "node:crypto";
import { db } from "@nexus-form/database";
import { form, formIntegration } from "@nexus-form/database/schema";
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

function parseConfig(configJson: unknown): GoogleSheetsIntegrationSetting {
  const raw =
    typeof configJson === "string" ? JSON.parse(configJson) : configJson;
  const parsed = GoogleSheetsIntegrationSettingSchema.safeParse(raw);
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

export async function upsertFormIntegrationForCurrentOwner(params: {
  formId: string;
  config: GoogleSheetsIntegrationSetting;
}): Promise<FormIntegrationRecord | null> {
  return await db.transaction(async (tx) => {
    const [formRecord] = await tx
      .select({ creatorId: form.creatorId })
      .from(form)
      .where(eq(form.id, params.formId))
      .for("update")
      .limit(1);

    if (!formRecord) return null;

    const [existing] = await tx
      .select()
      .from(formIntegration)
      .where(eq(formIntegration.formId, params.formId))
      .limit(1);

    if (existing) {
      await tx
        .update(formIntegration)
        .set({
          ownerUserId: formRecord.creatorId,
          userId: formRecord.creatorId,
          configJson: params.config,
        })
        .where(eq(formIntegration.formId, params.formId));
    } else {
      await tx.insert(formIntegration).values({
        id: randomUUID(),
        formId: params.formId,
        ownerUserId: formRecord.creatorId,
        userId: formRecord.creatorId,
        configJson: JSON.stringify(params.config),
      });
    }

    const [record] = await tx
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
      config: parseConfig(record.configJson),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  });
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
