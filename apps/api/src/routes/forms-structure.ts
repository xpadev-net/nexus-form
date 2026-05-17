import { randomUUID } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { db } from "@nexus-form/database";
import { formSchedule, formSnapshot } from "@nexus-form/database/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withDualFormAuth } from "../lib/dual-auth";
import {
  FormStructureNotFoundError,
  SnapshotNotFoundError,
} from "../lib/errors/form-errors";
import {
  getFormStructure,
  getFormStructureDiff,
  getFormStructureHistory,
  restoreFormStructure,
  saveFormStructure,
} from "../lib/forms/form-structure-service";
import {
  activateSnapshot,
  restoreFromSnapshotVersion,
} from "../lib/forms/snapshot-repository";
import { withFormStructureMutationLock } from "../lib/forms/structure-mutation-lock";
import { createHonoApp } from "../lib/hono";
import { hashPassword } from "../lib/security/password";
import {
  FormStructure,
  type FormStructure as FormStructureType,
} from "../types/domain/form";
import {
  ActivateSnapshotResponseSchema,
  RestoreEditResponseSchema,
} from "../types/domain/form-snapshot";
import { StoredLogicRuleSchema } from "../types/validation/form";

const structureUpdateSchema = z.object({
  structure: FormStructure,
  changeLog: z.string().max(500).optional(),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["version", "createdAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

const diffQuerySchema = z.object({
  fromVersion: z.coerce.number().int().min(1),
  toVersion: z.coerce.number().int().min(1),
});

const restoreSchema = z.object({
  version: z.number().int().min(1),
  changeLog: z.string().max(500).optional(),
});

const accessControlUpdateSchema = z.object({
  password_protection: z.object({
    enabled: z.boolean(),
    password: z.string().min(8).optional(),
    password_hint: z.string().max(200).optional(),
  }),
});

const logicUpdateSchema = z.object({
  logic: z.array(StoredLogicRuleSchema),
});

const futureDatetime = z
  .string()
  .datetime()
  .refine((val) => new Date(val) > new Date(), {
    message: "triggerAt must be in the future",
  });

const scheduleCreateSchema = z.discriminatedUnion("action", [
  z.object({ triggerAt: futureDatetime, action: z.literal("PUBLISH") }),
  z.object({
    triggerAt: futureDatetime,
    action: z.literal("UNPUBLISH"),
  }),
  z.object({
    triggerAt: futureDatetime,
    action: z.literal("SWITCH_SNAPSHOT"),
    snapshotVersion: z.number().int().min(1),
  }),
]);

const scheduleUpdateSchema = z
  .object({
    triggerAt: futureDatetime.optional(),
    action: z.enum(["PUBLISH", "UNPUBLISH", "SWITCH_SNAPSHOT"]).optional(),
    snapshotVersion: z.number().int().min(1).nullable().optional(),
    processedAt: z.string().datetime().nullable().optional(),
  })
  .refine(
    (data) =>
      data.action !== "SWITCH_SNAPSHOT" ||
      (data.snapshotVersion !== null && data.snapshotVersion !== undefined),
    { message: "snapshotVersion is required for SWITCH_SNAPSHOT action" },
  );

export const formsStructureRouter = createHonoApp()
  .use("/:id/structure*", withDualFormAuth("VIEWER"))
  .use("/:id/snapshots*", withDualFormAuth("VIEWER"))
  .use("/:id/schedule*", withDualFormAuth("VIEWER"))
  .get("/:id/structure", async (c) => {
    const formId = c.req.param("id");
    let structure: FormStructureType;
    try {
      structure = await getFormStructure(formId);
    } catch (error) {
      if (error instanceof FormStructureNotFoundError) {
        return c.json({ error: "Form structure not found" }, 404);
      }
      throw error;
    }
    // パスワードハッシュをクライアントに露出しないようマスクする
    const ac = structure.access_control;
    if (ac?.password_protection) {
      const { password, ...ppWithoutHash } = ac.password_protection;
      return c.json({
        structure: {
          ...structure,
          access_control: {
            ...ac,
            password_protection: {
              ...ppWithoutHash,
              has_password: !!password,
            },
          },
        },
      });
    }
    return c.json({ structure });
  })
  .put(
    "/:id/structure",
    withDualFormAuth("EDITOR"),
    zValidator("json", structureUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      const payload = c.req.valid("json");

      const result = await withFormStructureMutationLock(formId, async () => {
        // クライアントは GET レスポンスのマスク済み構造（has_password=true, password なし）を
        // そのまま PUT してくる可能性がある。その場合は DB の既存ハッシュを復元して保存する。
        let structure = payload.structure;
        const ac = structure.access_control;
        const pp = ac?.password_protection;
        if (ac && pp?.has_password && !pp.password) {
          const currentStructure = await getFormStructure(formId);
          const existingHash =
            currentStructure.access_control?.password_protection?.password;
          if (existingHash) {
            structure = {
              ...structure,
              access_control: {
                ...ac,
                password_protection: {
                  ...pp,
                  password: existingHash,
                  has_password: undefined,
                },
              },
            };
          } else {
            // 並行 PATCH 等でハッシュが DB から消えていた場合、保護を無効化してフラグを除去する
            structure = {
              ...structure,
              access_control: {
                ...ac,
                password_protection: {
                  ...pp,
                  enabled: false,
                  has_password: undefined,
                },
              },
            };
          }
        } else if (ac && pp && pp.has_password !== undefined) {
          // has_password が false 等、上のブランチに該当しない場合もフラグを除去して DB に残さない
          structure = {
            ...structure,
            access_control: {
              ...ac,
              password_protection: { ...pp, has_password: undefined },
            },
          };
        }

        return saveFormStructure(
          formId,
          structure,
          auth.user_id,
          payload.changeLog,
        );
      }).catch((error) => {
        if (error instanceof FormStructureNotFoundError) {
          return null;
        }
        throw error;
      });
      if (!result) {
        return c.json({ error: "Form structure not found" }, 404);
      }
      return c.json({ structure: result });
    },
  )
  .get(
    "/:id/structure/history",
    zValidator("query", historyQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const query = c.req.valid("query");
      const history = await getFormStructureHistory(formId, query);
      return c.json(history);
    },
  )
  .get(
    "/:id/structure/diff",
    zValidator("query", diffQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const query = c.req.valid("query");
      const diff = await getFormStructureDiff(
        formId,
        query.fromVersion,
        query.toVersion,
      );
      return c.json(diff);
    },
  )
  .post(
    "/:id/structure/restore",
    withDualFormAuth("EDITOR"),
    zValidator("json", restoreSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      const payload = c.req.valid("json");
      const restored = await withFormStructureMutationLock(formId, () =>
        restoreFormStructure(
          formId,
          payload.version,
          auth.user_id,
          payload.changeLog,
        ),
      );
      return c.json({ structure: restored });
    },
  )
  .patch(
    "/:id/structure/logic",
    withDualFormAuth("EDITOR"),
    zValidator("json", logicUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      const payload = c.req.valid("json");

      const result = await withFormStructureMutationLock(formId, async () => {
        const currentStructure = await getFormStructure(formId);

        return saveFormStructure(
          formId,
          {
            ...currentStructure,
            logic: payload.logic,
          },
          auth.user_id,
          "Update logic rules",
        );
      }).catch((error) => {
        if (error instanceof FormStructureNotFoundError) {
          return null;
        }
        throw error;
      });

      if (!result) {
        return c.json({ error: "Form structure not found" }, 404);
      }

      return c.json({ structure: result });
    },
  )
  .patch(
    "/:id/structure/access-control",
    withDualFormAuth("EDITOR"),
    zValidator("json", accessControlUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);
      const payload = c.req.valid("json");

      const hashedPassword = payload.password_protection.password
        ? await hashPassword(payload.password_protection.password)
        : undefined;

      const result = await withFormStructureMutationLock(formId, async () => {
        let currentStructure: FormStructureType;
        try {
          currentStructure = await getFormStructure(formId);
        } catch (error) {
          if (error instanceof FormStructureNotFoundError) {
            return null;
          }
          throw error;
        }

        const currentAc = currentStructure.access_control ?? {
          require_authentication: false,
        };
        const currentPp = currentAc.password_protection;

        const newPassword = hashedPassword ?? currentPp?.password;

        if (payload.password_protection.enabled && !newPassword) {
          return {
            error: "パスワードを設定してから保護を有効にしてください",
          };
        }

        // 空文字列は「ヒントを削除」として扱い、undefined は既存値を保持する
        const newHint =
          payload.password_protection.password_hint === ""
            ? undefined
            : (payload.password_protection.password_hint ??
              currentPp?.password_hint);

        const updatedStructure = {
          ...currentStructure,
          access_control: {
            ...currentAc,
            password_protection: {
              enabled: payload.password_protection.enabled,
              password: newPassword,
              password_hint: newHint,
            },
          },
        };

        await saveFormStructure(
          formId,
          updatedStructure,
          auth.user_id,
          "Update password protection settings",
        );

        return {
          passwordProtection: {
            enabled: payload.password_protection.enabled,
            has_password: !!newPassword,
            password_hint: newHint,
          },
        };
      });

      if (result === null) {
        return c.json({ error: "Form structure not found" }, 404);
      }
      if ("error" in result) {
        return c.json({ error: result.error }, 400);
      }

      return c.json({
        ok: true,
        password_protection: result.passwordProtection,
      });
    },
  )
  .get("/:id/snapshots", async (c) => {
    const formId = c.req.param("id");
    const snapshots = await db
      .select({
        id: formSnapshot.id,
        formId: formSnapshot.formId,
        version: formSnapshot.version,
        isActive: formSnapshot.isActive,
        publishedBy: formSnapshot.publishedBy,
        publishedAt: formSnapshot.publishedAt,
        changeLog: formSnapshot.changeLog,
        title: formSnapshot.title,
        description: formSnapshot.description,
        parentVersion: formSnapshot.parentVersion,
      })
      .from(formSnapshot)
      .where(eq(formSnapshot.formId, formId))
      .orderBy(desc(formSnapshot.version));
    return c.json({ snapshots });
  })
  .get(
    "/:id/snapshots/diff",
    zValidator("query", diffQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const { fromVersion, toVersion } = c.req.valid("query");
      const [fromSnapshotRows, toSnapshotRows] = await Promise.all([
        db
          .select({
            plateContent: formSnapshot.plateContent,
            validationRulesJson: formSnapshot.validationRulesJson,
            version: formSnapshot.version,
          })
          .from(formSnapshot)
          .where(
            and(
              eq(formSnapshot.formId, formId),
              eq(formSnapshot.version, fromVersion),
            ),
          )
          .limit(1),
        db
          .select({
            plateContent: formSnapshot.plateContent,
            validationRulesJson: formSnapshot.validationRulesJson,
            version: formSnapshot.version,
          })
          .from(formSnapshot)
          .where(
            and(
              eq(formSnapshot.formId, formId),
              eq(formSnapshot.version, toVersion),
            ),
          )
          .limit(1),
      ]);

      const from = fromSnapshotRows[0];
      const to = toSnapshotRows[0];
      if (!from || !to) return c.json({ error: "Snapshot not found" }, 404);

      return c.json({
        fromVersion,
        toVersion,
        changed:
          from.plateContent !== to.plateContent ||
          from.validationRulesJson !== to.validationRulesJson,
        fromPlateContent: from.plateContent,
        toPlateContent: to.plateContent,
      });
    },
  )
  .get("/:id/snapshots/:version/content", async (c) => {
    const formId = c.req.param("id");
    const version = Number(c.req.param("version"));
    if (!Number.isInteger(version) || version < 1) {
      return c.json({ error: "Invalid version" }, 400);
    }

    const [snapshot] = await db
      .select({
        plateContent: formSnapshot.plateContent,
        version: formSnapshot.version,
        publishedAt: formSnapshot.publishedAt,
      })
      .from(formSnapshot)
      .where(
        and(eq(formSnapshot.formId, formId), eq(formSnapshot.version, version)),
      )
      .limit(1);

    if (!snapshot) {
      return c.json({ error: "Snapshot not found" }, 404);
    }

    return c.json({
      plateContent: snapshot.plateContent,
      version: snapshot.version,
      publishedAt: snapshot.publishedAt,
    });
  })
  .post(
    "/:id/snapshots/:version/activate",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const version = Number(c.req.param("version"));
      if (!Number.isInteger(version) || version < 1)
        return c.json({ error: "Invalid version" }, 400);

      try {
        const updated = await activateSnapshot(formId, version);
        const response = ActivateSnapshotResponseSchema.parse({
          ok: true,
          snapshot: updated,
        });
        return c.json(response);
      } catch (error) {
        if (error instanceof SnapshotNotFoundError) {
          return c.json({ error: "Snapshot not found" }, 404);
        }
        throw error;
      }
    },
  )
  .post(
    "/:id/snapshots/:version/restore-edit",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const version = Number(c.req.param("version"));
      if (!Number.isInteger(version) || version < 1)
        return c.json({ error: "Invalid version" }, 400);

      const auth = c.get("dualAuthContext");
      if (!auth) return c.json({ error: "Unauthorized" }, 401);

      try {
        await withFormStructureMutationLock(formId, () =>
          restoreFromSnapshotVersion(formId, version),
        );
        const response = RestoreEditResponseSchema.parse({ ok: true });
        return c.json(response);
      } catch (error) {
        if (error instanceof SnapshotNotFoundError) {
          return c.json({ error: "Snapshot not found" }, 404);
        }
        throw error;
      }
    },
  )
  .get("/:id/schedule", async (c) => {
    const formId = c.req.param("id");
    const schedules = await db
      .select()
      .from(formSchedule)
      .where(eq(formSchedule.formId, formId))
      .orderBy(asc(formSchedule.triggerAt));
    return c.json({ schedules });
  })
  .post(
    "/:id/schedule",
    withDualFormAuth("EDITOR"),
    zValidator("json", scheduleCreateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const payload = c.req.valid("json");
      const id = randomUUID();
      await db.insert(formSchedule).values({
        id,
        formId,
        triggerAt: new Date(payload.triggerAt),
        action: payload.action,
        snapshotVersion:
          payload.action === "SWITCH_SNAPSHOT" ? payload.snapshotVersion : null,
      });
      const [schedule] = await db
        .select()
        .from(formSchedule)
        .where(eq(formSchedule.id, id))
        .limit(1);
      return c.json({ schedule }, 201);
    },
  )
  .get("/:id/schedule/:scheduleId", async (c) => {
    const formId = c.req.param("id");
    const scheduleId = c.req.param("scheduleId");
    const [schedule] = await db
      .select()
      .from(formSchedule)
      .where(
        and(eq(formSchedule.id, scheduleId), eq(formSchedule.formId, formId)),
      )
      .limit(1);
    if (!schedule) return c.json({ error: "Schedule not found" }, 404);
    return c.json({ schedule });
  })
  .put(
    "/:id/schedule/:scheduleId",
    withDualFormAuth("EDITOR"),
    zValidator("json", scheduleUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const scheduleId = c.req.param("scheduleId");
      const payload = c.req.valid("json");

      const [schedule] = await db
        .select()
        .from(formSchedule)
        .where(
          and(eq(formSchedule.id, scheduleId), eq(formSchedule.formId, formId)),
        )
        .limit(1);
      if (!schedule) return c.json({ error: "Schedule not found" }, 404);

      const effectiveAction = payload.action ?? schedule.action;
      const effectiveSnapshotVersion =
        payload.snapshotVersion === null
          ? null
          : payload.snapshotVersion !== undefined
            ? payload.snapshotVersion
            : schedule.snapshotVersion;

      if (
        effectiveAction === "SWITCH_SNAPSHOT" &&
        effectiveSnapshotVersion == null
      ) {
        return c.json(
          { error: "snapshotVersion is required for SWITCH_SNAPSHOT action" },
          400,
        );
      }

      await db
        .update(formSchedule)
        .set({
          triggerAt: payload.triggerAt
            ? new Date(payload.triggerAt)
            : undefined,
          action: payload.action,
          snapshotVersion:
            effectiveAction === "SWITCH_SNAPSHOT"
              ? effectiveSnapshotVersion
              : null,
          processedAt:
            payload.processedAt === null
              ? null
              : payload.processedAt
                ? new Date(payload.processedAt)
                : undefined,
        })
        .where(eq(formSchedule.id, scheduleId));

      const [updated] = await db
        .select()
        .from(formSchedule)
        .where(eq(formSchedule.id, scheduleId))
        .limit(1);

      return c.json({ schedule: updated ?? null });
    },
  )
  .delete(
    "/:id/schedule/:scheduleId",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const scheduleId = c.req.param("scheduleId");
      const [target] = await db
        .select({ id: formSchedule.id })
        .from(formSchedule)
        .where(
          and(eq(formSchedule.id, scheduleId), eq(formSchedule.formId, formId)),
        )
        .limit(1);
      if (!target) return c.json({ error: "Schedule not found" }, 404);
      await db.delete(formSchedule).where(eq(formSchedule.id, scheduleId));
      return c.json({ ok: true });
    },
  );
