import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  paginationMetadata,
  paginationQuerySchema,
} from "../lib/constants/pagination";
import { withDualFormAuth } from "../lib/dual-auth";
import {
  countValidationRules,
  createValidationRule,
  deleteValidationRule,
  getValidationRule,
  listValidationRules,
  reorderValidationRules,
  updateValidationRule,
  ValidationRuleConfigError,
  ValidationRuleNotFoundError,
} from "../lib/forms/validation-rule-repository";
import { createHonoApp } from "../lib/hono";
import { OkResponseSchema } from "../types/domain/form-row";
import { isoDate } from "../types/domain/iso-date";
import {
  CreateFormValidationRuleSchema,
  FormValidationRuleSchema,
  ReorderFormValidationRulesSchema,
  UpdateFormValidationRuleSchema,
} from "../types/domain/validation-rule";

const FormValidationRuleWireSchema = FormValidationRuleSchema.extend({
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const PaginatedFormValidationRulesResponseSchema = z.object({
  rules: z.array(FormValidationRuleWireSchema),
  pagination: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});
export type PaginatedFormValidationRulesResponse = z.infer<
  typeof PaginatedFormValidationRulesResponseSchema
>;

export const FormValidationRuleResponseSchema = z.object({
  rule: FormValidationRuleWireSchema,
});
export type FormValidationRuleResponse = z.infer<
  typeof FormValidationRuleResponseSchema
>;

function configErrorResponse(error: unknown): { error: string } | null {
  if (error instanceof ValidationRuleConfigError) {
    return { error: error.message };
  }
  return null;
}

export const formsValidationRulesRouter = createHonoApp()
  .use("/:id/validation-rules*", withDualFormAuth("VIEWER"))
  .get(
    "/:id/validation-rules",
    zValidator("query", paginationQuerySchema),
    async (c) => {
      const formId = c.req.param("id");
      const { page, pageSize } = c.req.valid("query");
      const offset = (page - 1) * pageSize;
      const [rules, total] = await Promise.all([
        listValidationRules(formId, { limit: pageSize, offset }),
        countValidationRules(formId),
      ]);
      return c.json(
        PaginatedFormValidationRulesResponseSchema.parse({
          rules,
          pagination: paginationMetadata(page, pageSize, total),
        }),
      );
    },
  )
  .post(
    "/:id/validation-rules",
    withDualFormAuth("EDITOR"),
    zValidator("json", CreateFormValidationRuleSchema),
    async (c) => {
      const formId = c.req.param("id");
      const payload = c.req.valid("json");
      try {
        const rule = await createValidationRule({ formId, payload });
        return c.json(FormValidationRuleResponseSchema.parse({ rule }), 201);
      } catch (error) {
        const response = configErrorResponse(error);
        if (response) return c.json(response, 400);
        throw error;
      }
    },
  )
  .put(
    "/:id/validation-rules/reorder",
    withDualFormAuth("EDITOR"),
    zValidator("json", ReorderFormValidationRulesSchema),
    async (c) => {
      const formId = c.req.param("id");
      const { orderings } = c.req.valid("json");
      await reorderValidationRules({ formId, orderings });
      return c.json(OkResponseSchema.parse({ ok: true }));
    },
  )
  .get("/:id/validation-rules/:ruleId", async (c) => {
    const formId = c.req.param("id");
    const ruleId = c.req.param("ruleId");
    const rule = await getValidationRule(formId, ruleId);
    if (!rule) return c.json({ error: "Validation rule not found" }, 404);
    return c.json(FormValidationRuleResponseSchema.parse({ rule }));
  })
  .put(
    "/:id/validation-rules/:ruleId",
    withDualFormAuth("EDITOR"),
    zValidator("json", UpdateFormValidationRuleSchema),
    async (c) => {
      const formId = c.req.param("id");
      const ruleId = c.req.param("ruleId");
      const payload = c.req.valid("json");
      try {
        const rule = await updateValidationRule({ formId, ruleId, payload });
        return c.json(FormValidationRuleResponseSchema.parse({ rule }));
      } catch (error) {
        if (error instanceof ValidationRuleNotFoundError) {
          return c.json({ error: error.message }, 404);
        }
        const response = configErrorResponse(error);
        if (response) return c.json(response, 400);
        throw error;
      }
    },
  )
  .delete(
    "/:id/validation-rules/:ruleId",
    withDualFormAuth("EDITOR"),
    async (c) => {
      const formId = c.req.param("id");
      const ruleId = c.req.param("ruleId");
      const ok = await deleteValidationRule({ formId, ruleId });
      if (!ok) return c.json({ error: "Validation rule not found" }, 404);
      return c.json(OkResponseSchema.parse({ ok: true }));
    },
  );
