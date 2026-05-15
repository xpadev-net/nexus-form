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
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { withDualFormAuth } from "../lib/dual-auth";
import { processFormSchedule } from "../lib/forms/schedule-processor";
import { getLatestSnapshot } from "../lib/forms/snapshot-repository";
import { parseValidationRuleSnapshot } from "../lib/forms/validation-rule-repository";
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

    // blockId は再生成しない。structureJson / snapshot / validationRuleBlock が
    // 同じ blockId を参照しているため、再生成すると参照が壊れる。blockId は
    // フォーム単位でスコープされ、フォーム間で重複しても問題ない。
    await db.transaction(async (tx) => {
      // 1. フォーム本体
      await tx.insert(form).values({
        id: newFormId,
        creatorId: auth.user_id,
        title: `${sourceForm.title} (コピー)`,
        description: sourceForm.description,
        publicId,
        status: "DRAFT",
        allowEditResponses: sourceForm.allowEditResponses,
        plateContent: sourceForm.plateContent,
        plateContentVersion: 0,
      });

      // 2. 最新 active な formStructure（version は 1 にリセット）
      const [sourceStructure] = await tx
        .select()
        .from(formStructure)
        .where(
          and(eq(formStructure.formId, id), eq(formStructure.isActive, true)),
        )
        .orderBy(desc(formStructure.version))
        .limit(1);
      if (sourceStructure) {
        await tx.insert(formStructure).values({
          id: randomUUID(),
          formId: newFormId,
          structureJson: sourceStructure.structureJson,
          version: 1,
          createdBy: auth.user_id,
          isActive: true,
          changeLog: sourceStructure.changeLog,
          parentVersion: null,
        });
      }

      // 3. validation rules と参照ブロック（rule ごとに新 ID を割り当て）。
      //    snapshot の validationRulesJson を remap するため、ここで
      //    旧 ID → 新 ID のマップを構築しておく。
      const ruleIdMap = new Map<string, string>();
      const sourceRules = await tx
        .select()
        .from(formValidationRule)
        .where(eq(formValidationRule.formId, id));
      for (const rule of sourceRules) {
        const newRuleId = randomUUID();
        ruleIdMap.set(rule.id, newRuleId);
        await tx.insert(formValidationRule).values({
          id: newRuleId,
          formId: newFormId,
          name: rule.name,
          providerName: rule.providerName,
          ruleType: rule.ruleType,
          configJson: rule.configJson,
          orderIndex: rule.orderIndex,
        });

        const sourceBlocks = await tx
          .select()
          .from(formValidationRuleBlock)
          .where(eq(formValidationRuleBlock.ruleId, rule.id));
        if (sourceBlocks.length > 0) {
          await tx.insert(formValidationRuleBlock).values(
            sourceBlocks.map((block) => ({
              id: randomUUID(),
              ruleId: newRuleId,
              referencedBlockId: block.referencedBlockId,
              orderIndex: block.orderIndex,
            })),
          );
        }
      }

      // 4. 最新 active な formSnapshot（publish に必要・version は 1 にリセット）。
      //    validationRulesJson の各 entry.id は新 rule ID へ remap する。
      //    対応する rule が無い entry は dangling FK を避けるため除外する。
      const [sourceSnapshot] = await tx
        .select()
        .from(formSnapshot)
        .where(
          and(eq(formSnapshot.formId, id), eq(formSnapshot.isActive, true)),
        )
        .orderBy(desc(formSnapshot.version))
        .limit(1);
      if (sourceSnapshot) {
        const remappedRules = parseValidationRuleSnapshot(
          sourceSnapshot.validationRulesJson,
        ).flatMap((entry) => {
          const newRuleId = ruleIdMap.get(entry.id);
          return newRuleId ? [{ ...entry, id: newRuleId }] : [];
        });
        await tx.insert(formSnapshot).values({
          id: randomUUID(),
          formId: newFormId,
          version: 1,
          isActive: true,
          publishedBy: auth.user_id,
          changeLog: sourceSnapshot.changeLog,
          title: sourceSnapshot.title,
          description: sourceSnapshot.description,
          parentVersion: null,
          plateContent: sourceSnapshot.plateContent,
          validationRulesJson: JSON.stringify(remappedRules),
        });
      }
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
