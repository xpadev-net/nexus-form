import { describe, expect, it } from "vitest";
import {
  getValidationResultId,
  validationResultIdentitySchema,
} from "../validation-results";

describe("validationResultIdentitySchema", () => {
  it("requires nonempty identity fields", () => {
    expect(() =>
      validationResultIdentitySchema.parse({
        responseId: "response-1",
        ruleId: "",
        referencedBlockId: "question-1",
      }),
    ).toThrow();
  });
});

describe("getValidationResultId", () => {
  it("returns a stable id for the validation result unique key", () => {
    const params = {
      responseId: "response-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
    };

    expect(getValidationResultId(params)).toBe(getValidationResultId(params));
    expect(getValidationResultId(params)).toMatch(
      /^validation-result:[a-f0-9]{32}$/,
    );
  });

  it("changes when any unique key component changes", () => {
    const base = {
      responseId: "response-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
    };

    expect(getValidationResultId(base)).not.toBe(
      getValidationResultId({ ...base, referencedBlockId: "question-2" }),
    );
  });
});
