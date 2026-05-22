import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { withDualFormAuth } from "../lib/dual-auth";
import { FormStructureNotFoundError } from "../lib/errors/form-errors";
import {
  getFormStructure,
  getFormStructureDiff,
  getFormStructureHistory,
  restoreFormStructure,
  saveFormStructure,
} from "../lib/forms/form-structure-service";
import { withFormStructureMutationLock } from "../lib/forms/structure-mutation-lock";
import { createHonoApp } from "../lib/hono";
import { resolveAuditUserId } from "../lib/resolve-audit-user-id";
import { hashPassword } from "../lib/security/password";
import {
  FormStructure,
  type FormStructure as FormStructureType,
} from "../types/domain/form";
import { isoDate } from "../types/domain/iso-date";
import { StoredLogicRuleSchema } from "../types/validation/form";
import { formVersionDiffQuerySchema } from "./form-route-schemas";

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

const servicePaginationSchema = z.object({
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
  hasNext: z.boolean(),
  hasPrev: z.boolean(),
});

const FormStructureEnvelopeSchema = z.object({
  structure: FormStructure,
});
export type FormStructureEnvelope = z.infer<typeof FormStructureEnvelopeSchema>;

const FormStructureErrorResponseSchema = z.object({
  error: z.string().min(1),
});

/**
 * Error response shape returned by forms structure endpoints.
 *
 * The `error` field carries the client-facing error message validated by
 * {@link FormStructureErrorResponseSchema}.
 */
export type FormStructureErrorResponse = z.infer<
  typeof FormStructureErrorResponseSchema
>;

const formStructureError = (error: string): FormStructureErrorResponse => {
  const parsed = FormStructureErrorResponseSchema.safeParse({ error });
  return parsed.success ? parsed.data : { error: "Request failed" };
};

const FormStructureVersionSchema = z.object({
  id: z.string(),
  formId: z.string(),
  version: z.number().int().min(1),
  createdAt: isoDate,
  changeLog: z.string().nullable(),
  parentVersion: z.number().int().min(1).nullable(),
});

const FormStructureVersionResponseSchema = z.object({
  structure: FormStructureVersionSchema,
});
export type FormStructureVersionResponse = z.infer<
  typeof FormStructureVersionResponseSchema
>;

const FormStructureHistoryResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      version: z.number().int().min(1),
      createdAt: z.string().datetime(),
      createdBy: z.string().nullable(),
      changeLog: z.string().nullable(),
      isActive: z.boolean(),
      parentVersion: z.number().int().min(1).nullable(),
    }),
  ),
  pagination: servicePaginationSchema,
});
export type FormStructureHistoryResponse = z.infer<
  typeof FormStructureHistoryResponseSchema
>;

const StructureDiffChangeSchema = z.object({
  type: z.enum(["added", "removed", "modified"]),
  path: z.string(),
  from: z.unknown().optional(),
  to: z.unknown().optional(),
});

const FormStructureDiffResponseSchema = z.object({
  fromVersion: z.number().int().min(1),
  toVersion: z.number().int().min(1),
  changes: z.array(StructureDiffChangeSchema),
  metadata: z.object({
    memoryUsedMB: z.number(),
    calculationTime: z.number().int(),
  }),
});
export type FormStructureDiffResponse = z.infer<
  typeof FormStructureDiffResponseSchema
>;

const AccessControlUpdateResponseSchema = z.object({
  ok: z.literal(true),
  password_protection: z.object({
    enabled: z.boolean(),
    has_password: z.boolean(),
    password_hint: z.string().optional(),
  }),
});
export type AccessControlUpdateResponse = z.infer<
  typeof AccessControlUpdateResponseSchema
>;

export const formsStructureRouter = createHonoApp()
  .use("/:id/structure*", withDualFormAuth("VIEWER"))
  .get("/:id/structure", async (c) => {
    const formId = c.req.param("id");
    let structure: FormStructureType;
    try {
      structure = await getFormStructure(formId);
    } catch (error) {
      if (error instanceof FormStructureNotFoundError) {
        return c.json(formStructureError("Form structure not found"), 404);
      }
      throw error;
    }
    // パスワードハッシュをクライアントに露出しないようマスクする
    const ac = structure.access_control;
    if (ac?.password_protection) {
      const { password, ...ppWithoutHash } = ac.password_protection;
      return c.json(
        FormStructureEnvelopeSchema.parse({
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
        }),
      );
    }
    return c.json(FormStructureEnvelopeSchema.parse({ structure }));
  })
  .put(
    "/:id/structure",
    withDualFormAuth("EDITOR"),
    zValidator("json", structureUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(formStructureError("Unauthorized"), 401);
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
          resolveAuditUserId(auth.user_id),
          payload.changeLog,
        );
      }).catch((error) => {
        if (error instanceof FormStructureNotFoundError) {
          return null;
        }
        throw error;
      });
      if (!result) {
        return c.json(formStructureError("Form structure not found"), 404);
      }
      return c.json(
        FormStructureVersionResponseSchema.parse({ structure: result }),
      );
    },
  )
  .get(
    "/:id/structure/history",
    zValidator("query", historyQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const query = c.req.valid("query");
      const history = await getFormStructureHistory(formId, query);
      return c.json(FormStructureHistoryResponseSchema.parse(history));
    },
  )
  .get(
    "/:id/structure/diff",
    zValidator("query", formVersionDiffQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const query = c.req.valid("query");
      const diff = await getFormStructureDiff(
        formId,
        query.fromVersion,
        query.toVersion,
      );
      return c.json(FormStructureDiffResponseSchema.parse(diff));
    },
  )
  .post(
    "/:id/structure/restore",
    withDualFormAuth("EDITOR"),
    zValidator("json", restoreSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(formStructureError("Unauthorized"), 401);
      const payload = c.req.valid("json");
      const restored = await withFormStructureMutationLock(formId, () =>
        restoreFormStructure(
          formId,
          payload.version,
          resolveAuditUserId(auth.user_id),
          payload.changeLog,
        ),
      );
      return c.json(
        FormStructureVersionResponseSchema.parse({ structure: restored }),
      );
    },
  )
  .patch(
    "/:id/structure/logic",
    withDualFormAuth("EDITOR"),
    zValidator("json", logicUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(formStructureError("Unauthorized"), 401);
      const payload = c.req.valid("json");

      const result = await withFormStructureMutationLock(formId, async () => {
        const currentStructure = await getFormStructure(formId);

        return saveFormStructure(
          formId,
          {
            ...currentStructure,
            logic: payload.logic,
          },
          resolveAuditUserId(auth.user_id),
          "Update logic rules",
        );
      }).catch((error) => {
        if (error instanceof FormStructureNotFoundError) {
          return null;
        }
        throw error;
      });

      if (!result) {
        return c.json(formStructureError("Form structure not found"), 404);
      }

      return c.json(
        FormStructureVersionResponseSchema.parse({ structure: result }),
      );
    },
  )
  .patch(
    "/:id/structure/access-control",
    withDualFormAuth("EDITOR"),
    zValidator("json", accessControlUpdateSchema),
    async (c) => {
      const formId = c.req.param("id");
      const auth = c.get("dualAuthContext");
      if (!auth) return c.json(formStructureError("Unauthorized"), 401);
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
          resolveAuditUserId(auth.user_id),
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
        return c.json(formStructureError("Form structure not found"), 404);
      }
      if ("error" in result && typeof result.error === "string") {
        return c.json(formStructureError(result.error), 400);
      }

      return c.json(
        AccessControlUpdateResponseSchema.parse({
          ok: true,
          password_protection: result.passwordProtection,
        }),
      );
    },
  );
