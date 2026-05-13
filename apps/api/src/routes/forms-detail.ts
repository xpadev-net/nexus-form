import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db, form } from "@nexus-form/database";
import {
  apiToken,
  externalServiceValidationResult,
  fingerprintDetail,
  formIntegration,
  formInvitation,
  formPermission,
  formResponse,
  formSchedule,
  formShareLink,
  formSnapshot,
  formStructure,
  formValidationRule,
  formValidationRuleBlock,
} from "@nexus-form/database/schema";
import { regenerateBlockIds } from "@nexus-form/shared";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withDualFormAuth } from "../lib/dual-auth";
import { processFormSchedule } from "../lib/forms/schedule-processor";
import { getLatestSnapshot } from "../lib/forms/snapshot-repository";
import { createHonoApp } from "../lib/hono";

const updateFormSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
});

const transferOwnerSchema = z.object({
  newOwnerUserId: z.string().min(1),
});

export const formsDetailRouter = createHonoApp()
  .get("/:id", withDualFormAuth("VIEWER"), async (c) => {
    const id = c.req.param("id");
    await processFormSchedule(id).catch(() => {});
    const [target] = await db
      .select()
      .from(form)
      .where(eq(form.id, id))
      .limit(1);
    if (!target) return c.json({ error: "Form not found" }, 404);
    return c.json({ form: target });
  })
  .put(
    "/:id",
    withDualFormAuth("EDITOR"),
    zValidator("json", updateFormSchema),
    async (c) => {
      const id = c.req.param("id");
      const payload = c.req.valid("json");
      await db.update(form).set(payload).where(eq(form.id, id));
      const [updated] = await db
        .select()
        .from(form)
        .where(eq(form.id, id))
        .limit(1);
      return c.json({ form: updated ?? null });
    },
  )
  .delete("/:id", withDualFormAuth("OWNER"), async (c) => {
    const id = c.req.param("id");

    await db.transaction(async (tx) => {
      // Cascade delete related records in dependency order

      // 1. Delete response-level children (fingerprints, validation results)
      const responseRows = await tx
        .select({ id: formResponse.id })
        .from(formResponse)
        .where(eq(formResponse.formId, id));

      if (responseRows.length > 0) {
        const responseIds = responseRows.map((r) => r.id);
        await tx
          .delete(fingerprintDetail)
          .where(inArray(fingerprintDetail.responseId, responseIds));
        await tx
          .delete(externalServiceValidationResult)
          .where(
            inArray(externalServiceValidationResult.responseId, responseIds),
          );
      }

      // 2. Delete form-level validation rules (ruleBlocks first, then rules)
      const ruleRows = await tx
        .select({ id: formValidationRule.id })
        .from(formValidationRule)
        .where(eq(formValidationRule.formId, id));

      if (ruleRows.length > 0) {
        const ruleIds = ruleRows.map((r) => r.id);
        await tx
          .delete(formValidationRuleBlock)
          .where(inArray(formValidationRuleBlock.ruleId, ruleIds));
        await tx
          .delete(formValidationRule)
          .where(eq(formValidationRule.formId, id));
      }

      // 3. Delete share-link-associated API tokens
      const shareLinkRows = await tx
        .select({ id: formShareLink.id })
        .from(formShareLink)
        .where(eq(formShareLink.formId, id));

      if (shareLinkRows.length > 0) {
        const shareLinkIds = shareLinkRows.map((s) => s.id);
        await tx
          .delete(apiToken)
          .where(inArray(apiToken.shareLinkId, shareLinkIds));
      }

      // 4. Delete form-level children
      await tx.delete(formResponse).where(eq(formResponse.formId, id));
      await tx.delete(formSnapshot).where(eq(formSnapshot.formId, id));
      await tx.delete(formStructure).where(eq(formStructure.formId, id));
      await tx.delete(formSchedule).where(eq(formSchedule.formId, id));
      await tx.delete(formPermission).where(eq(formPermission.formId, id));
      await tx.delete(formShareLink).where(eq(formShareLink.formId, id));
      await tx.delete(formIntegration).where(eq(formIntegration.formId, id));
      await tx.delete(formInvitation).where(eq(formInvitation.formId, id));

      // 5. Delete the form itself
      await tx.delete(form).where(eq(form.id, id));
    });

    return c.json({ ok: true });
  })
  .post("/:id/publish", withDualFormAuth("EDITOR"), async (c) => {
    const id = c.req.param("id");
    const snapshot = await getLatestSnapshot(id);
    if (!snapshot) {
      return c.json(
        {
          error: "公開版のスナップショットが設定されていないため公開できません",
        },
        400,
      );
    }
    await db
      .update(form)
      .set({ status: "PUBLISHED", publishedAt: new Date() })
      .where(eq(form.id, id));
    return c.json({ ok: true });
  })
  .post("/:id/unpublish", withDualFormAuth("EDITOR"), async (c) => {
    const id = c.req.param("id");
    await db.update(form).set({ status: "UNPUBLISHED" }).where(eq(form.id, id));
    return c.json({ ok: true });
  })
  .post("/:id/archive", withDualFormAuth("EDITOR"), async (c) => {
    const id = c.req.param("id");
    await db.update(form).set({ status: "ARCHIVED" }).where(eq(form.id, id));
    return c.json({ ok: true });
  })
  .post("/:id/unarchive", withDualFormAuth("EDITOR"), async (c) => {
    const id = c.req.param("id");
    await db.update(form).set({ status: "DRAFT" }).where(eq(form.id, id));
    return c.json({ ok: true });
  })
  .post("/:id/regenerate-public-url", withDualFormAuth("EDITOR"), async (c) => {
    const id = c.req.param("id");
    const publicId = randomUUID();
    await db.update(form).set({ publicId }).where(eq(form.id, id));
    return c.json({ publicId });
  })
  .post(
    "/:id/transfer-ownership",
    withDualFormAuth("OWNER"),
    zValidator("json", transferOwnerSchema),
    async (c) => {
      const id = c.req.param("id");
      const { newOwnerUserId } = c.req.valid("json");
      await db
        .update(form)
        .set({ creatorId: newOwnerUserId })
        .where(eq(form.id, id));
      return c.json({ ok: true, ownerUserId: newOwnerUserId });
    },
  )
  .post("/:id/duplicate", withDualFormAuth("EDITOR"), async (c) => {
    const id = c.req.param("id");
    const auth = c.get("dualAuthContext");
    if (!auth) return c.json({ error: "Unauthorized" }, 401);

    const [sourceForm] = await db
      .select()
      .from(form)
      .where(eq(form.id, id))
      .limit(1);
    if (!sourceForm) return c.json({ error: "Form not found" }, 404);

    const newFormId = randomUUID();
    const publicId = randomUUID();

    // Duplicate Plate content with regenerated blockIds
    let duplicatedPlateContent: string | null = null;
    if (sourceForm.plateContent) {
      try {
        const parsed: unknown = JSON.parse(sourceForm.plateContent);
        if (Array.isArray(parsed)) {
          duplicatedPlateContent = JSON.stringify(regenerateBlockIds(parsed));
        }
      } catch {
        duplicatedPlateContent = null;
      }
    }

    await db.transaction(async (tx) => {
      await tx.insert(form).values({
        id: newFormId,
        creatorId: auth.user_id,
        title: `${sourceForm.title} (コピー)`,
        description: sourceForm.description,
        publicId,
        status: "DRAFT",
        allowEditResponses: sourceForm.allowEditResponses,
        plateContent: duplicatedPlateContent,
        plateContentVersion: 0,
      });
    });

    const [created] = await db
      .select()
      .from(form)
      .where(eq(form.id, newFormId))
      .limit(1);
    return c.json({ form: created }, 201);
  })
  .get("/:id/export", withDualFormAuth("VIEWER"), async (c) => {
    const id = c.req.param("id");
    const [target] = await db
      .select()
      .from(form)
      .where(eq(form.id, id))
      .limit(1);
    return c.json({ form: target ?? null });
  })
  .get("/:id/preview", withDualFormAuth("VIEWER"), async (c) => {
    const id = c.req.param("id");
    const [target] = await db
      .select()
      .from(form)
      .where(eq(form.id, id))
      .limit(1);
    return c.json({ form: target ?? null, preview: true });
  });
