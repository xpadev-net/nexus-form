import { db } from "@nexus-form/database";
import { form } from "@nexus-form/database/schema";
import { extractQuestionsFromPlateContent } from "@nexus-form/shared";
import { eq } from "drizzle-orm";

export interface PlateBlockInfo {
  blockId: string;
  type: string;
  title: string;
}

export async function getPlateBlocksForForm(
  formId: string,
): Promise<PlateBlockInfo[]> {
  const [row] = await db
    .select({ plateContent: form.plateContent })
    .from(form)
    .where(eq(form.id, formId))
    .limit(1);

  if (!row?.plateContent) return [];

  let content: unknown;
  try {
    content = JSON.parse(row.plateContent);
  } catch {
    return [];
  }

  if (!Array.isArray(content)) return [];

  return extractQuestionsFromPlateContent(content).map((q) => ({
    blockId: q.blockId,
    type: q.type,
    title: q.title,
  }));
}
