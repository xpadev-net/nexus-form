import { db } from "@nexus-form/database";
import { getValidationResultId } from "@nexus-form/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { extractReferencedValueFromJson } from "../response-data-extractor";
import {
  ConcurrentDeleteError,
  markValidationProcessing,
  writeValidationResult,
} from "../validation-helpers";

const {
  insertValues,
  onDuplicateKeyUpdate,
  publishValidationEvent,
  updateSet,
  updateWhere,
} = vi.hoisted(() => ({
  insertValues: vi.fn(),
  onDuplicateKeyUpdate: vi.fn(),
  publishValidationEvent: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    insert: vi.fn(() => ({
      values: insertValues,
    })),
    select: vi.fn(),
    update: vi.fn(() => ({
      set: updateSet,
    })),
  },
  externalServiceValidationResult: {
    id: "id",
    responseId: "responseId",
    ruleId: "ruleId",
    referencedBlockId: "referencedBlockId",
    attemptCount: "attemptCount",
  },
  formResponse: {
    id: "id",
    formId: "formId",
    responseDataJson: "responseDataJson",
  },
  formSnapshot: {
    formId: "formId",
    plateContent: "plateContent",
    isActive: "isActive",
    version: "version",
  },
}));

vi.mock("../redis-publisher", () => ({
  publishValidationEvent,
}));

beforeEach(() => {
  insertValues.mockReturnValue({ onDuplicateKeyUpdate });
  onDuplicateKeyUpdate.mockResolvedValue([{ affectedRows: 1 }]);
  updateSet.mockReturnValue({ where: updateWhere });
  updateWhere.mockResolvedValue([{ affectedRows: 1 }]);
  publishValidationEvent.mockResolvedValue(undefined);
  vi.mocked(db.select).mockClear();
  vi.mocked(db.insert).mockClear();
  vi.mocked(db.update).mockClear();
  insertValues.mockClear();
  onDuplicateKeyUpdate.mockClear();
  updateSet.mockClear();
  updateWhere.mockClear();
  publishValidationEvent.mockClear();
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

describe("writeValidationResult", () => {
  it("returns the deterministic result id without selecting after upsert", async () => {
    const params = {
      responseId: "response-1",
      formId: "form-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
      service: "discord",
      success: true,
      metadata: { ok: true },
      jobId: "job-1",
    };
    const expectedId = getValidationResultId(params);

    const resultId = await writeValidationResult(params);

    expect(resultId).toBe(expectedId);
    expect(db.select).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expectedId,
        responseId: params.responseId,
        ruleId: params.ruleId,
        referencedBlockId: params.referencedBlockId,
      }),
    );
    expect(onDuplicateKeyUpdate).toHaveBeenCalledWith({
      set: expect.objectContaining({
        id: expectedId,
        status: "COMPLETED",
        success: true,
      }),
    });
    expect(publishValidationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        validationResultId: expectedId,
        responseId: params.responseId,
        ruleId: params.ruleId,
        referencedBlockId: params.referencedBlockId,
        status: "COMPLETED",
      }),
    );
  });
});

describe("markValidationProcessing", () => {
  it("rewrites existing rows to the deterministic result id before publishing PROCESSING", async () => {
    const params = {
      responseId: "response-1",
      formId: "form-1",
      ruleId: "rule-1",
      referencedBlockId: "question-1",
      service: "discord",
    };
    const expectedId = getValidationResultId(params);

    await markValidationProcessing(params);

    expect(db.select).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith({
      id: expectedId,
      status: "PROCESSING",
    });
    expect(publishValidationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        validationResultId: expectedId,
        responseId: params.responseId,
        ruleId: params.ruleId,
        referencedBlockId: params.referencedBlockId,
        status: "PROCESSING",
      }),
    );
  });

  it("throws ConcurrentDeleteError when the processing row disappears before update", async () => {
    updateWhere.mockResolvedValueOnce([{ affectedRows: 0 }]);

    await expect(
      markValidationProcessing({
        responseId: "response-1",
        formId: "form-1",
        ruleId: "rule-1",
        referencedBlockId: "question-1",
        service: "discord",
      }),
    ).rejects.toBeInstanceOf(ConcurrentDeleteError);
  });
});

// ---------------------------------------------------------------------------
// extractReferencedValueFromJson — array format (new)
// ---------------------------------------------------------------------------
describe("extractReferencedValueFromJson (array format)", () => {
  it("extracts value from valid array format", () => {
    const json = JSON.stringify([
      {
        question_id: "q1",
        question_type: "short_text",
        value: "hello",
      },
    ]);
    expect(extractReferencedValueFromJson(json, "q1", "resp-1")).toBe("hello");
  });

  it("extracts checkbox values from array format", () => {
    const json = JSON.stringify([
      {
        question_id: "q1",
        question_type: "checkbox",
        values: ["a", "b"],
      },
    ]);
    expect(extractReferencedValueFromJson(json, "q1", "resp-1")).toBe("a,b");
  });

  it("throws when array items fail schema validation (e.g. numeric question_id)", () => {
    const json = JSON.stringify([
      { question_id: 123, question_type: "radio", value: "opt-a" },
    ]);
    expect(() => extractReferencedValueFromJson(json, "123", "resp-1")).toThrow(
      "responseDataJson array items failed schema validation for response resp-1",
    );
  });

  it("throws when block not found in array format", () => {
    const json = JSON.stringify([
      {
        question_id: "q1",
        question_type: "short_text",
        value: "hello",
      },
    ]);
    expect(() =>
      extractReferencedValueFromJson(json, "q999", "resp-1"),
    ).toThrow("Referenced block value not found: q999");
  });
});

// ---------------------------------------------------------------------------
// extractReferencedValueFromJson — error cases
// ---------------------------------------------------------------------------
describe("extractReferencedValueFromJson (error cases)", () => {
  it("throws for malformed JSON", () => {
    expect(() =>
      extractReferencedValueFromJson("{invalid", "q1", "resp-1"),
    ).toThrow("responseDataJson is not valid JSON for response resp-1");
  });

  it("throws when rawData is not an array", () => {
    const json = JSON.stringify({ q1: "value" });
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format for response resp-1",
    );
  });

  it("throws for non-object, non-array rawData (string)", () => {
    const json = JSON.stringify("just a string");
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format for response resp-1",
    );
  });

  it("throws for non-object, non-array rawData (number)", () => {
    const json = JSON.stringify(42);
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format for response resp-1",
    );
  });

  it("throws for null rawData", () => {
    const json = JSON.stringify(null);
    expect(() => extractReferencedValueFromJson(json, "q1", "resp-1")).toThrow(
      "Invalid responseDataJson format for response resp-1",
    );
  });
});
