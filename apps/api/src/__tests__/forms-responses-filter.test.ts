import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => {
  const schema = {
    externalServiceValidationResult: {
      responseId: "externalServiceValidationResult.responseId",
      status: "externalServiceValidationResult.status",
      success: "externalServiceValidationResult.success",
      tableName: "externalServiceValidationResult",
    },
    fingerprintDetail: {
      responseId: "fingerprintDetail.responseId",
      componentName: "fingerprintDetail.componentName",
      componentValueHash: "fingerprintDetail.componentValueHash",
      fingerprintType: "fingerprintDetail.fingerprintType",
      tableName: "fingerprintDetail",
    },
    form: {
      id: "form.id",
      plateContent: "form.plateContent",
    },
    formResponse: {
      id: "formResponse.id",
      formId: "formResponse.formId",
      responseDataJson: "formResponse.responseDataJson",
      submittedAt: "formResponse.submittedAt",
      updatedAt: "formResponse.updatedAt",
      respondentUuid: "formResponse.respondentUuid",
      userAgent: "formResponse.userAgent",
      sessionId: "formResponse.sessionId",
      countryCode: "formResponse.countryCode",
      tableName: "formResponse",
    },
    formValidationRule: {},
  };

  return {
    authAllowed: true,
    db: {
      select: vi.fn(),
    },
    schema,
  };
});

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
}));

vi.mock("@nexus-form/database/schema", () => mocks.schema);

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {},
}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth:
    () =>
    (
      c: { set: (k: string, v: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("auth", { userId: "user-1", role: "EDITOR" });
      return next();
    },
}));

import { formsResponsesRouter } from "../routes/forms-responses";

describe("formsResponsesRouter - response filtering and sorting", () => {
  const sampleResponses = [
    {
      id: "resp-1",
      formId: "form-1",
      submittedAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: null,
      respondentUuid: "user-uuid-1",
      userAgent: null,
      sessionId: "session-1",
      countryCode: "JP",
    },
    {
      id: "resp-2",
      formId: "form-1",
      submittedAt: new Date("2026-01-02T00:00:00.000Z"),
      updatedAt: null,
      respondentUuid: "user-uuid-2",
      userAgent: null,
      sessionId: "session-2",
      countryCode: "US",
    },
    {
      id: "resp-3",
      formId: "form-1",
      submittedAt: new Date("2026-01-03T00:00:00.000Z"),
      updatedAt: null,
      respondentUuid: "user-uuid-3",
      userAgent: null,
      sessionId: "session-2",
      countryCode: "US",
    },
  ];

  const sampleValidationResults = [
    {
      responseId: "resp-1",
      status: "COMPLETED",
      success: true,
    },
    {
      responseId: "resp-2",
      status: "FAILED",
      success: false,
    },
    {
      responseId: "resp-3",
      status: "PENDING",
      success: null,
    },
  ];

  const sampleFingerprints = [
    {
      responseId: "resp-1",
      componentName: "canvas",
      componentValueHash: "hash-unique-1",
      fingerprintType: "canvas",
    },
    {
      responseId: "resp-2",
      componentName: "canvas",
      componentValueHash: "hash-shared",
      fingerprintType: "canvas",
    },
    {
      responseId: "resp-3",
      componentName: "canvas",
      componentValueHash: "hash-shared",
      fingerprintType: "canvas",
    },
  ];

  function createQueryChainMock(rows: Array<Record<string, unknown>>) {
    const offsetChain = {
      limit: vi.fn().mockResolvedValue(rows),
    };
    const orderedChain = {
      offset: vi.fn().mockReturnValue(offsetChain),
      limit: vi.fn().mockResolvedValue(rows),
    };
    const whereChain = {
      orderBy: vi.fn().mockReturnValue(orderedChain),
      offset: vi.fn().mockReturnValue(offsetChain),
      limit: vi.fn().mockResolvedValue(rows),
    };
    return {
      where: vi.fn().mockReturnValue(whereChain),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mocks.db.select.mockImplementation((selection) => {
      const columns = selection
        ? Object.keys(selection as Record<string, string>)
        : [];

      if (columns.includes("plateContent")) {
        return {
          from: vi
            .fn()
            .mockReturnValue(createQueryChainMock([{ plateContent: "[]" }])),
        };
      }

      if (columns.includes("status")) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(sampleValidationResults),
          }),
        };
      }

      if (
        columns.includes("componentName") ||
        columns.includes("fingerprintType")
      ) {
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(sampleFingerprints),
          }),
        };
      }

      return {
        from: vi.fn().mockReturnValue(createQueryChainMock(sampleResponses)),
      };
    });
  });

  it("filters responses by validationStatus=SUCCESS", async () => {
    const res = await formsResponsesRouter.request(
      "http://localhost/form-1/responses?validationStatus=SUCCESS",
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      responses: Array<{ id: string; validationStatus?: string }>;
    };
    expect(body.responses).toBeDefined();
    expect(body.responses.length).toBe(1);
    expect(body.responses[0]?.id).toBe("resp-1");
  });

  it("filters responses by minScore and maxScore range", async () => {
    const res = await formsResponsesRouter.request(
      "http://localhost/form-1/responses?minScore=0.5&maxScore=1.0",
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      responses: Array<{ id: string; uniquenessScore: number | null }>;
    };
    expect(body.responses).toBeDefined();
    expect(body.responses.length).toBe(1);
    expect(body.responses[0]?.id).toBe("resp-1");
    expect(body.responses[0]?.uniquenessScore).toBe(1.0);
  });

  it("sorts responses by uniquenessScore", async () => {
    const res = await formsResponsesRouter.request(
      "http://localhost/form-1/responses?sort=uniquenessScore&order=asc",
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      responses: Array<{ id: string; uniquenessScore: number | null }>;
    };
    expect(body.responses).toBeDefined();
    expect(body.responses.length).toBe(3);
    const scores = body.responses.map((r) => r.uniquenessScore);
    expect(scores[0]).toBe(0.0);
    expect(scores[1]).toBe(0.0);
    expect(scores[2]).toBe(1.0);
    expect(body.responses[2]?.id).toBe("resp-1");
  });
});
