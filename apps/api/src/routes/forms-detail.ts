import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db, form, user } from "@nexus-form/database";
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
import { FormStructureNotFoundError } from "../lib/errors/form-errors";
import { getFormStructure } from "../lib/forms/form-structure-service";
import { logFormScheduleError } from "../lib/forms/schedule-error-logging";
import { processFormSchedule } from "../lib/forms/schedule-processor";
import { getLatestSnapshot } from "../lib/forms/snapshot-repository";
import { withFormStructureMutationLock } from "../lib/forms/structure-mutation-lock";
import { parseValidationRuleSnapshot } from "../lib/forms/validation-rule-repository";
import { createHonoApp } from "../lib/hono";
import { errorResponse } from "../types/domain/common";
import {
  type FormStructure,
  FormStructure as FormStructureSchema,
} from "../types/domain/form";
import {
  FormCreateResponseSchema,
  FormDetailResponseSchema,
  FormNullableResponseSchema,
  FormPreviewResponseSchema,
  OkResponseSchema,
  RegeneratePublicUrlResponseSchema,
  TransferOwnershipResponseSchema,
} from "../types/domain/form-row";

const updateFormSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
});

const updateResponseSettingsSchema = z.object({
  allowEdit: z.boolean(),
  maxResponses: z.number().int().min(0).max(100000).nullable(),
  requireFingerprint: z.boolean(),
});

export const UpdateResponseSettingsResponseSchema = z.object({
  success: z.literal(true),
});
export type UpdateResponseSettingsResponse = z.infer<
  typeof UpdateResponseSettingsResponseSchema
>;

const transferOwnerSchema = z.object({
  newOwnerUserId: z.string().min(1),
});

async function getCurrentOrDefaultStructure(
  formId: string,
): Promise<FormStructure> {
  try {
    return await getFormStructure(formId);
  } catch (error) {
    if (error instanceof FormStructureNotFoundError) {
      return {
        version: 1,
        settings: { allow_edit_responses: false },
      };
    }
    throw error;
  }
}

export const formsDetailRouter = createHonoApp()
  .get("/:id", withDualFormAuth("VIEWER"), async (c) => {
    const id = c.req.param("id");
    await processFormSchedule(id).catch((error) =>
      logFormScheduleError(error, {
        formId: id,
        operation: "GET /forms/:id",
      }),
    );
    const [target] = await db
      .select()
      .from(form)
      .where(eq(form.id, id))
      .limit(1);
    if (!target) return c.json(errorResponse("Form not found"), 404);
    return c.json(FormDetailResponseSchema.parse({ form: target }));
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
      return c.json(
        FormNullableResponseSchema.parse({ form: updated ?? null }),
      );
    },
  )
  .patch(
    "/:id/settings/responses",
    withDualFormAuth("EDITOR"),
    zValidator("json", updateResponseSettingsSchema),
    async (c) => {
      const id = c.req.param("id");
      const payload = c.req.valid("json");
      const authCtx = c.get("dualAuthContext");

      await withFormStructureMutationLock(id, async () => {
        const currentStructure = await getCurrentOrDefaultStructure(id);
        const currentResponseLimit = currentStructure.settings.response_limit;
        const responseLimit =
          payload.maxResponses && payload.maxResponses > 0
            ? {
                enabled: true,
                max_responses: payload.maxResponses,
                ...(currentResponseLimit?.message
                  ? { message: currentResponseLimit.message }
                  : {}),
              }
            : undefined;

        const updatedStructure: FormStructure = {
          ...currentStructure,
          settings: {
            ...currentStructure.settings,
            allow_edit_responses: payload.allowEdit,
            require_fingerprint: payload.requireFingerprint,
            ...(responseLimit ? { response_limit: responseLimit } : {}),
          },
        };
        if (!responseLimit) {
          delete updatedStructure.settings.response_limit;
        }

        const validatedStructure = FormStructureSchema.parse(updatedStructure);
        const createdBy = authCtx?.user_id ?? "unknown";

        await db.transaction(async (tx) => {
          const [latestStructure] = await tx
            .select({ version: formStructure.version })
            .from(formStructure)
            .where(eq(formStructure.formId, id))
            .orderBy(desc(formStructure.version))
            .limit(1);
          const currentVersion = latestStructure?.version ?? 0;
          const nextVersion = currentVersion + 1;

          await tx
            .update(formStructure)
            .set({ isActive: false })
            .where(
              and(
                eq(formStructure.formId, id),
                eq(formStructure.isActive, true),
              ),
            );
          await tx.insert(formStructure).values({
            id: randomUUID(),
            formId: id,
            structureJson: JSON.stringify(validatedStructure),
            version: nextVersion,
            createdBy,
            changeLog: "Update response settings",
            parentVersion: currentVersion > 0 ? currentVersion : null,
          });
          await tx
            .update(form)
            .set({ allowEditResponses: payload.allowEdit })
            .where(eq(form.id, id));
        });
      });

      return c.json(
        UpdateResponseSettingsResponseSchema.parse({ success: true }),
      );
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

    return c.json(OkResponseSchema.parse({ ok: true }));
  })
  .post("/:id/publish", withDualFormAuth("EDITOR"), async (c) => {
    const id = c.req.param("id");
    const snapshot = await getLatestSnapshot(id);
    if (!snapshot) {
      return c.json(
        errorResponse(
          "公開版のスナップショットが設定されていないため公開できません",
        ),
        400,
      );
    }
    await db
      .update(form)
      .set({ status: "PUBLISHED", publishedAt: new Date() })
      .where(eq(form.id, id));
    return c.json(OkResponseSchema.parse({ ok: true }));
  })
  .post("/:id/unpublish", withDualFormAuth("EDITOR"), async (c) => {
    const id = c.req.param("id");
    await db.update(form).set({ status: "UNPUBLISHED" }).where(eq(form.id, id));
    return c.json(OkResponseSchema.parse({ ok: true }));
  })
  .post("/:id/archive", withDualFormAuth("EDITOR"), async (c) => {
    const id = c.req.param("id");
    await db.update(form).set({ status: "ARCHIVED" }).where(eq(form.id, id));
    return c.json(OkResponseSchema.parse({ ok: true }));
  })
  .post("/:id/unarchive", withDualFormAuth("EDITOR"), async (c) => {
    const id = c.req.param("id");
    await db.update(form).set({ status: "DRAFT" }).where(eq(form.id, id));
    return c.json(OkResponseSchema.parse({ ok: true }));
  })
  .post("/:id/regenerate-public-url", withDualFormAuth("EDITOR"), async (c) => {
    const id = c.req.param("id");
    const publicId = randomUUID();
    await db.update(form).set({ publicId }).where(eq(form.id, id));
    return c.json(RegeneratePublicUrlResponseSchema.parse({ publicId }));
  })
  .post(
    "/:id/transfer-ownership",
    withDualFormAuth("OWNER"),
    zValidator("json", transferOwnerSchema),
    async (c) => {
      const id = c.req.param("id");
      const { newOwnerUserId } = c.req.valid("json");

      const [targetUser] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, newOwnerUserId))
        .limit(1);
      if (!targetUser) {
        return c.json(errorResponse("User not found"), 404);
      }

      await db.transaction(async (tx) => {
        // FOR UPDATE forces a current read, serialising concurrent transfers on this row.
        const [currentForm] = await tx
          .select({ creatorId: form.creatorId })
          .from(form)
          .where(eq(form.id, id))
          .for("update")
          .limit(1);
        const previousOwnerId = currentForm?.creatorId;

        await tx
          .update(form)
          .set({ creatorId: newOwnerUserId })
          .where(eq(form.id, id));

        // Grant the previous owner EDITOR access so they don't lose access.
        if (previousOwnerId && previousOwnerId !== newOwnerUserId) {
          await tx
            .insert(formPermission)
            .values({
              id: randomUUID(),
              formId: id,
              userId: previousOwnerId,
              role: "EDITOR",
            })
            .onDuplicateKeyUpdate({ set: { role: "EDITOR" } });
        }
      });

      return c.json(
        TransferOwnershipResponseSchema.parse({
          ok: true,
          ownerUserId: newOwnerUserId,
        }),
      );
    },
  )
  .post("/:id/duplicate", withDualFormAuth("EDITOR"), async (c) => {
    const id = c.req.param("id");
    const auth = c.get("dualAuthContext");
    if (!auth) return c.json(errorResponse("Unauthorized"), 401);

    const [sourceForm] = await db
      .select()
      .from(form)
      .where(eq(form.id, id))
      .limit(1);
    if (!sourceForm) return c.json(errorResponse("Form not found"), 404);

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
      if (sourceRules.length > 0) {
        // 参照ブロックは全 rule 分を 1 クエリで取得し、N+1 を避ける。
        const sourceBlocks = await tx
          .select()
          .from(formValidationRuleBlock)
          .where(
            inArray(
              formValidationRuleBlock.ruleId,
              sourceRules.map((rule) => rule.id),
            ),
          );
        const blocksByRuleId = new Map<string, typeof sourceBlocks>();
        for (const block of sourceBlocks) {
          const list = blocksByRuleId.get(block.ruleId);
          if (list) {
            list.push(block);
          } else {
            blocksByRuleId.set(block.ruleId, [block]);
          }
        }

        const newRuleRows: (typeof formValidationRule.$inferInsert)[] = [];
        const newBlockRows: (typeof formValidationRuleBlock.$inferInsert)[] =
          [];
        for (const rule of sourceRules) {
          const newRuleId = randomUUID();
          ruleIdMap.set(rule.id, newRuleId);
          newRuleRows.push({
            id: newRuleId,
            formId: newFormId,
            name: rule.name,
            providerName: rule.providerName,
            ruleType: rule.ruleType,
            configJson: rule.configJson,
            orderIndex: rule.orderIndex,
          });
          for (const block of blocksByRuleId.get(rule.id) ?? []) {
            newBlockRows.push({
              id: randomUUID(),
              ruleId: newRuleId,
              referencedBlockId: block.referencedBlockId,
              orderIndex: block.orderIndex,
            });
          }
        }

        await tx.insert(formValidationRule).values(newRuleRows);
        if (newBlockRows.length > 0) {
          await tx.insert(formValidationRuleBlock).values(newBlockRows);
        }
      }

      // 4. 最新 active な formSnapshot（publish に必要・version は 1 にリセット）。
      //    validationRulesJson の各 entry.id は新 rule ID へ remap する。
      //    複製元に active snapshot が無い場合はスキップする。その場合
      //    複製フォームは /publish 前に明示的な snapshot 作成が必要となる
      //    （複製元自体が未公開状態なら、これは想定どおりの挙動）。
      const [sourceSnapshot] = await tx
        .select()
        .from(formSnapshot)
        .where(
          and(eq(formSnapshot.formId, id), eq(formSnapshot.isActive, true)),
        )
        .orderBy(desc(formSnapshot.version))
        .limit(1);
      if (sourceSnapshot) {
        const snapshotEntries = parseValidationRuleSnapshot(
          sourceSnapshot.validationRulesJson,
        );

        // snapshot にしか存在しない rule（複製元で公開後に削除された等で
        // 現在の formValidationRule に無いもの）も新 rule として作成する。
        // こうしないと remap 先が無く、複製 snapshot の validation が
        // 複製元より欠落してしまう。
        const extraRuleRows: (typeof formValidationRule.$inferInsert)[] = [];
        const extraBlockRows: (typeof formValidationRuleBlock.$inferInsert)[] =
          [];
        for (const entry of snapshotEntries) {
          if (ruleIdMap.has(entry.id)) continue;
          const newRuleId = randomUUID();
          ruleIdMap.set(entry.id, newRuleId);
          extraRuleRows.push({
            id: newRuleId,
            formId: newFormId,
            name: entry.name,
            providerName: entry.providerName,
            ruleType: entry.ruleType,
            configJson: entry.configJson,
            orderIndex: entry.orderIndex,
          });
          // (ruleId, referencedBlockId) は unique のため重複ブロックを除外する。
          const seenBlockIds = new Set<string>();
          let blockOrder = 0;
          for (const blockId of entry.referencedBlockIds) {
            if (seenBlockIds.has(blockId)) continue;
            seenBlockIds.add(blockId);
            extraBlockRows.push({
              id: randomUUID(),
              ruleId: newRuleId,
              referencedBlockId: blockId,
              orderIndex: blockOrder++,
            });
          }
        }
        if (extraRuleRows.length > 0) {
          await tx.insert(formValidationRule).values(extraRuleRows);
        }
        if (extraBlockRows.length > 0) {
          await tx.insert(formValidationRuleBlock).values(extraBlockRows);
        }

        // 上で全 entry の rule を確保したため、remap 先は必ず存在する。
        const remappedRules = snapshotEntries.map((entry) => ({
          ...entry,
          id: ruleIdMap.get(entry.id) ?? entry.id,
        }));
        await tx.insert(formSnapshot).values({
          id: randomUUID(),
          formId: newFormId,
          version: 1,
          isActive: true,
          publishedBy: auth.user_id,
          changeLog: sourceSnapshot.changeLog,
          // snapshot の title/description は配信時にそのまま使われるため、
          // 複製元の snapshot 値ではなく複製フォームの値に合わせる。
          title: `${sourceForm.title} (コピー)`,
          description: sourceForm.description,
          parentVersion: null,
          plateContent: sourceSnapshot.plateContent,
          validationRulesJson: JSON.stringify(remappedRules),
        });

        // 通常の snapshot 作成（snapshot-repository.ts）と同様、フォームの
        // baseSnapshotVersion をこの snapshot バージョンに合わせ、差分判定が
        // 「未公開変更なし」と正しく認識できるようにする。
        await tx
          .update(form)
          .set({ baseSnapshotVersion: 1 })
          .where(eq(form.id, newFormId));
      }
    });

    const [created] = await db
      .select()
      .from(form)
      .where(eq(form.id, newFormId))
      .limit(1);
    return c.json(FormCreateResponseSchema.parse({ form: created }), 201);
  })
  .get("/:id/export", withDualFormAuth("VIEWER"), async (c) => {
    const id = c.req.param("id");
    const [target] = await db
      .select()
      .from(form)
      .where(eq(form.id, id))
      .limit(1);
    return c.json(FormNullableResponseSchema.parse({ form: target ?? null }));
  })
  .get("/:id/preview", withDualFormAuth("VIEWER"), async (c) => {
    const id = c.req.param("id");
    const [target] = await db
      .select()
      .from(form)
      .where(eq(form.id, id))
      .limit(1);
    return c.json(
      FormPreviewResponseSchema.parse({ form: target ?? null, preview: true }),
    );
  });
