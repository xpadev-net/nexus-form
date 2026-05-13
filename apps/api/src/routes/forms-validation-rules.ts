import { zValidator } from "@hono/zod-validator";
import { withDualFormAuth } from "../lib/dual-auth";
import {
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
import {
  CreateFormValidationRuleSchema,
  ReorderFormValidationRulesSchema,
  UpdateFormValidationRuleSchema,
} from "../types/domain/validation-rule";

function configErrorResponse(error: unknown): { error: string } | null {
  if (error instanceof ValidationRuleConfigError) {
    return { error: error.message };
  }
  return null;
}

export const formsValidationRulesRouter = createHonoApp()
  .use("/:id/validation-rules*", withDualFormAuth("VIEWER"))
  .get("/:id/validation-rules", async (c) => {
    const formId = c.req.param("id");
    const rules = await listValidationRules(formId);
    return c.json({ rules });
  })
  .post(
    "/:id/validation-rules",
    withDualFormAuth("EDITOR"),
    zValidator("json", CreateFormValidationRuleSchema),
    async (c) => {
      const formId = c.req.param("id");
      const payload = c.req.valid("json");
      try {
        const rule = await createValidationRule({ formId, payload });
        return c.json({ rule }, 201);
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
      return c.json({ ok: true });
    },
  )
  .get("/:id/validation-rules/:ruleId", async (c) => {
    const formId = c.req.param("id");
    const ruleId = c.req.param("ruleId");
    const rule = await getValidationRule(formId, ruleId);
    if (!rule) return c.json({ error: "Validation rule not found" }, 404);
    return c.json({ rule });
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
        return c.json({ rule });
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
      return c.json({ ok: true });
    },
  );
