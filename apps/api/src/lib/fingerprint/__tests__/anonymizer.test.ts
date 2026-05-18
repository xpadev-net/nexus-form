import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FingerprintAnonymizer } from "../anonymizer";

type FingerprintRow = {
  id: string;
  responseId: string;
  fingerprintType: string;
  componentValueHash: string;
  collectedAt: Date;
  respId: string;
  respFormId: string;
  respSubmittedAt: Date;
  respRespondentUuid: string;
};

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock("node:crypto", async () => {
  const actual =
    await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomUUID: mocks.randomUUID,
  };
});

vi.mock("@nexus-form/database", () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  fingerprintDetail: {
    id: "fingerprintDetail.id",
    responseId: "fingerprintDetail.responseId",
    fingerprintType: "fingerprintDetail.fingerprintType",
    componentValueHash: "fingerprintDetail.componentValueHash",
    collectedAt: "fingerprintDetail.collectedAt",
  },
  formResponse: {
    id: "formResponse.id",
    formId: "formResponse.formId",
    submittedAt: "formResponse.submittedAt",
    respondentUuid: "formResponse.respondentUuid",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions, op: "and" })),
  count: vi.fn(() => "count"),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, op: "eq", right })),
}));

function createFingerprintRow(
  overrides: Partial<FingerprintRow> = {},
): FingerprintRow {
  return {
    id: "fingerprint-1",
    responseId: "response-1",
    fingerprintType: "browser",
    componentValueHash: "hash-shared",
    collectedAt: new Date("2026-01-01T00:00:00.000Z"),
    respId: "response-1",
    respFormId: "form-a",
    respSubmittedAt: new Date("2026-01-01T00:00:00.000Z"),
    respRespondentUuid: "respondent-1",
    ...overrides,
  };
}

function queueFingerprintRows(rows: FingerprintRow[]): void {
  const query = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue(rows),
    where: vi.fn().mockReturnThis(),
  };

  mocks.select.mockReturnValueOnce(query);
}

function queueFingerprintById(
  row: FingerprintRow,
  duplicateCount: number,
): void {
  const fingerprintQuery = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([row]),
    where: vi.fn().mockReturnThis(),
  };
  const countQuery = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ value: duplicateCount }]),
  };

  mocks.select
    .mockReturnValueOnce(fingerprintQuery)
    .mockReturnValueOnce(countQuery);
}

const randomUUIDMock = vi.mocked(randomUUID);

beforeEach(() => {
  mocks.select.mockReset();
  randomUUIDMock.mockReset();
  FingerprintAnonymizer.getInstance().resetAnonymizationMap();
});

describe("FingerprintAnonymizer", () => {
  it("reuses anonymized IDs only within a single getAnonymizedFingerprints call", async () => {
    randomUUIDMock.mockReturnValueOnce("00000000-0000-4000-8000-000000000001");
    queueFingerprintRows([
      createFingerprintRow({ id: "fingerprint-1", responseId: "response-1" }),
      createFingerprintRow({ id: "fingerprint-2", responseId: "response-2" }),
    ]);

    const result =
      await FingerprintAnonymizer.getInstance().getAnonymizedFingerprints(
        undefined,
        "form-a",
      );

    expect(result.fingerprints).toHaveLength(2);
    expect(result.fingerprints[0]?.anonymizedId).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(result.fingerprints[1]?.anonymizedId).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(randomUUIDMock).toHaveBeenCalledTimes(1);
    expect(FingerprintAnonymizer.getInstance().getAnonymizationMapSize()).toBe(
      0,
    );
  });

  it("does not correlate the same fingerprint hash across separate calls", async () => {
    randomUUIDMock
      .mockReturnValueOnce("00000000-0000-4000-8000-00000000000a")
      .mockReturnValueOnce("00000000-0000-4000-8000-00000000000b");
    queueFingerprintRows([
      createFingerprintRow({ id: "fingerprint-a", respFormId: "form-a" }),
    ]);
    queueFingerprintRows([
      createFingerprintRow({ id: "fingerprint-b", respFormId: "form-b" }),
    ]);

    const first =
      await FingerprintAnonymizer.getInstance().getAnonymizedFingerprints(
        undefined,
        "form-a",
      );
    const second =
      await FingerprintAnonymizer.getInstance().getAnonymizedFingerprints(
        undefined,
        "form-b",
      );

    expect(first.fingerprints[0]?.anonymizedId).toBe(
      "00000000-0000-4000-8000-00000000000a",
    );
    expect(second.fingerprints[0]?.anonymizedId).toBe(
      "00000000-0000-4000-8000-00000000000b",
    );
    expect(first.fingerprints[0]?.anonymizedId).not.toBe(
      second.fingerprints[0]?.anonymizedId,
    );
    expect(randomUUIDMock).toHaveBeenCalledTimes(2);
    expect(FingerprintAnonymizer.getInstance().getAnonymizationMapSize()).toBe(
      0,
    );
  });

  it("does not reuse anonymized IDs across getAnonymizedFingerprintById calls", async () => {
    const anonymizer = FingerprintAnonymizer.getInstance();
    randomUUIDMock
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000010")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000011");
    queueFingerprintById(createFingerprintRow({ id: "fingerprint-a" }), 2);
    queueFingerprintById(createFingerprintRow({ id: "fingerprint-b" }), 2);

    const first =
      await anonymizer.getAnonymizedFingerprintById("fingerprint-a");
    const second =
      await anonymizer.getAnonymizedFingerprintById("fingerprint-b");

    expect(first?.anonymizedId).toBe("00000000-0000-4000-8000-000000000010");
    expect(second?.anonymizedId).toBe("00000000-0000-4000-8000-000000000011");
    expect(first?.anonymizedId).not.toBe(second?.anonymizedId);
    expect(first?.isDuplicate).toBe(true);
    expect(second?.duplicateCount).toBe(2);
    expect(randomUUIDMock).toHaveBeenCalledTimes(2);
    anonymizer.resetAnonymizationMap();
    expect(anonymizer.getAnonymizationMapSize()).toBe(0);
  });
});
