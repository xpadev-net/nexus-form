import type { FormStatusValue } from "@nexus-form/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const schema = {
    form: {
      id: "form.id",
      status: "form.status",
      publishedAt: "form.publishedAt",
      unpublishedAt: "form.unpublishedAt",
      creatorId: "form.creatorId",
    },
    formSchedule: {
      createdAt: "formSchedule.createdAt",
      id: "formSchedule.id",
      formId: "formSchedule.formId",
      processedAt: "formSchedule.processedAt",
      triggerAt: "formSchedule.triggerAt",
    },
  };

  return {
    activateSnapshot: vi.fn(),
    and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
    asc: vi.fn((column: unknown) => ({ type: "asc", column })),
    dbTransaction: vi.fn(),
    dbUpdate: vi.fn(),
    eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
    formLimit: vi.fn(),
    isNull: vi.fn((column: unknown) => ({ type: "isNull", column })),
    lockModes: [] as string[],
    logError: vi.fn(),
    lte: vi.fn((left: unknown, right: unknown) => ({
      type: "lte",
      left,
      right,
    })),
    orderByArgs: [] as unknown[],
    scheduleForUpdate: vi.fn(),
    schema,
    tx: {
      select: vi.fn(),
      update: vi.fn(),
    },
    updateCalls: [] as Array<{
      table: unknown;
      values: unknown;
      condition: unknown;
    }>,
    updateResults: [] as Array<{ affectedRows: number }>,
  };
});

vi.mock("@nexus-form/database", () => ({
  db: {
    transaction: mocks.dbTransaction,
    update: mocks.dbUpdate,
  },
}));

vi.mock("@nexus-form/database/schema", () => mocks.schema);

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  asc: mocks.asc,
  eq: mocks.eq,
  isNull: mocks.isNull,
  lte: mocks.lte,
}));

vi.mock("../snapshot-repository", () => ({
  activateSnapshot: mocks.activateSnapshot,
}));

vi.mock("../../logger", () => ({
  logError: mocks.logError,
}));

import { processFormSchedule } from "../schedule-processor";

type ScheduleRow = {
  id: string;
  formId: string;
  triggerAt: Date;
  action: "PUBLISH" | "UNPUBLISH" | "SWITCH_SNAPSHOT";
  snapshotVersion: number | null;
  processedAt: Date | null;
};

function scheduleRow(overrides: Partial<ScheduleRow>): ScheduleRow {
  return {
    id: "schedule-1",
    formId: "form-1",
    triggerAt: new Date("2026-06-01T10:00:00.000Z"),
    action: "PUBLISH",
    snapshotVersion: null,
    processedAt: null,
    ...overrides,
  };
}

function useSelectRows(params: {
  formStatus: FormStatusValue;
  schedules: ScheduleRow[];
}): void {
  mocks.formLimit.mockResolvedValue([
    {
      id: "form-1",
      status: params.formStatus,
      publishedAt: null,
      unpublishedAt: null,
      creatorId: "user-1",
    },
  ]);
  mocks.scheduleForUpdate.mockResolvedValue(params.schedules);

  let selectCall = 0;
  mocks.tx.select.mockImplementation(() => {
    selectCall += 1;
    if (selectCall === 1) {
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            for: vi.fn((mode: string) => {
              mocks.lockModes.push(mode);
              return { limit: mocks.formLimit };
            }),
          })),
        })),
      };
    }

    return {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn((...args: unknown[]) => {
            mocks.orderByArgs = args;
            return {
              for: vi.fn((mode: string) => {
                mocks.lockModes.push(mode);
                return mocks.scheduleForUpdate();
              }),
            };
          }),
        })),
      })),
    };
  });
}

function useUpdateResults(results: Array<{ affectedRows: number }>): void {
  mocks.updateResults = [...results];
  mocks.tx.update.mockImplementation((table: unknown) => ({
    set: vi.fn((values: unknown) => ({
      where: vi.fn(async (condition: unknown) => {
        mocks.updateCalls.push({ table, values, condition });
        return [mocks.updateResults.shift() ?? { affectedRows: 1 }];
      }),
    })),
  }));
}

describe("processFormSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lockModes.length = 0;
    mocks.orderByArgs.length = 0;
    mocks.updateCalls.length = 0;
    mocks.updateResults.length = 0;
    mocks.dbTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(mocks.tx),
    );
    mocks.dbUpdate.mockImplementation((table: unknown) => ({
      set: vi.fn((values: unknown) => ({
        where: vi.fn(async (condition: unknown) => {
          mocks.updateCalls.push({ table, values, condition });
          return [mocks.updateResults.shift() ?? { affectedRows: 1 }];
        }),
      })),
    }));
  });

  it("catches up UNPUBLISH then PUBLISH using the in-transaction current status", async () => {
    const unpublishAt = new Date("2026-06-01T10:00:00.000Z");
    const publishAt = new Date("2026-06-01T11:00:00.000Z");
    const now = new Date("2026-06-01T12:00:00.000Z");
    useSelectRows({
      formStatus: "PUBLISHED",
      schedules: [
        scheduleRow({
          id: "schedule-unpublish",
          triggerAt: unpublishAt,
          action: "UNPUBLISH",
        }),
        scheduleRow({
          id: "schedule-publish",
          triggerAt: publishAt,
          action: "PUBLISH",
        }),
      ],
    });
    useUpdateResults([
      { affectedRows: 1 },
      { affectedRows: 1 },
      { affectedRows: 1 },
      { affectedRows: 1 },
    ]);

    const result = await processFormSchedule("form-1", now);

    expect(result).toEqual({
      processed: true,
      statusChanged: true,
      newStatus: "PUBLISHED",
      message: "Form automatically published based on schedule",
    });
    expect(mocks.lockModes).toEqual(["update", "update"]);
    expect(mocks.orderByArgs).toEqual([
      { type: "asc", column: "formSchedule.triggerAt" },
      { type: "asc", column: "formSchedule.createdAt" },
      { type: "asc", column: "formSchedule.id" },
    ]);
    expect(
      mocks.updateCalls
        .filter((call) => call.table === mocks.schema.form)
        .map((call) => call.values),
    ).toEqual([
      { status: "UNPUBLISHED", unpublishedAt: unpublishAt },
      { status: "PUBLISHED", publishedAt: publishAt },
    ]);
    expect(
      mocks.updateCalls
        .filter((call) => call.table === mocks.schema.formSchedule)
        .map((call) => call.values),
    ).toEqual([{ processedAt: now }, { processedAt: now }]);
  });

  it("catches up PUBLISH then UNPUBLISH to the later terminal status", async () => {
    const publishAt = new Date("2026-06-01T10:00:00.000Z");
    const unpublishAt = new Date("2026-06-01T11:00:00.000Z");
    const now = new Date("2026-06-01T12:00:00.000Z");
    useSelectRows({
      formStatus: "DRAFT",
      schedules: [
        scheduleRow({
          id: "schedule-publish",
          triggerAt: publishAt,
          action: "PUBLISH",
        }),
        scheduleRow({
          id: "schedule-unpublish",
          triggerAt: unpublishAt,
          action: "UNPUBLISH",
        }),
      ],
    });
    useUpdateResults([
      { affectedRows: 1 },
      { affectedRows: 1 },
      { affectedRows: 1 },
      { affectedRows: 1 },
    ]);

    const result = await processFormSchedule("form-1", now);

    expect(result).toMatchObject({
      processed: true,
      statusChanged: true,
      newStatus: "UNPUBLISHED",
      message: "Form automatically unpublished based on schedule",
    });
    expect(
      mocks.updateCalls
        .filter((call) => call.table === mocks.schema.form)
        .map((call) => call.values),
    ).toEqual([
      { status: "PUBLISHED", publishedAt: publishAt },
      { status: "UNPUBLISHED", unpublishedAt: unpublishAt },
    ]);
  });

  it("reports a concurrent CAS miss without applying the stale action", async () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    useSelectRows({
      formStatus: "DRAFT",
      schedules: [
        scheduleRow({
          id: "schedule-publish",
          action: "PUBLISH",
        }),
      ],
    });
    useUpdateResults([{ affectedRows: 0 }]);

    const result = await processFormSchedule("form-1", now);

    expect(result).toEqual({
      processed: true,
      statusChanged: false,
      newStatus: "DRAFT",
      message: "Schedule was already processed by another worker; skipped",
    });
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]?.table).toBe(mocks.schema.formSchedule);
    expect(mocks.updateCalls[0]?.values).toEqual({ processedAt: now });
  });

  it("claims SWITCH_SNAPSHOT before activating the snapshot", async () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    useSelectRows({
      formStatus: "PUBLISHED",
      schedules: [
        scheduleRow({
          id: "schedule-switch",
          action: "SWITCH_SNAPSHOT",
          snapshotVersion: 2,
        }),
      ],
    });
    useUpdateResults([{ affectedRows: 1 }]);
    mocks.activateSnapshot.mockImplementation(async () => {
      mocks.updateCalls.push({
        table: "snapshot-activation",
        values: { snapshotVersion: 2 },
        condition: null,
      });
    });

    const result = await processFormSchedule("form-1", now);

    expect(result).toEqual({
      processed: true,
      statusChanged: false,
      newStatus: "PUBLISHED",
      message: "Snapshot switched to version 2 based on schedule",
    });
    expect(mocks.updateCalls.map((call) => call.table)).toEqual([
      mocks.schema.formSchedule,
      "snapshot-activation",
    ]);
    expect(mocks.updateCalls[0]?.values).toEqual({ processedAt: now });
  });

  it("skips SWITCH_SNAPSHOT activation when the processedAt CAS loses", async () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    useSelectRows({
      formStatus: "PUBLISHED",
      schedules: [
        scheduleRow({
          id: "schedule-switch",
          action: "SWITCH_SNAPSHOT",
          snapshotVersion: 2,
        }),
      ],
    });
    useUpdateResults([{ affectedRows: 0 }]);

    const result = await processFormSchedule("form-1", now);

    expect(result).toEqual({
      processed: true,
      statusChanged: false,
      newStatus: "PUBLISHED",
      message: "Schedule was already processed by another worker; skipped",
    });
    expect(mocks.activateSnapshot).not.toHaveBeenCalled();
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]?.values).toEqual({ processedAt: now });
  });

  it("keeps a status-change message when a later SWITCH_SNAPSHOT CAS loses", async () => {
    const publishAt = new Date("2026-06-01T10:00:00.000Z");
    const now = new Date("2026-06-01T12:00:00.000Z");
    useSelectRows({
      formStatus: "DRAFT",
      schedules: [
        scheduleRow({
          id: "schedule-publish",
          triggerAt: publishAt,
          action: "PUBLISH",
        }),
        scheduleRow({
          id: "schedule-switch",
          action: "SWITCH_SNAPSHOT",
          snapshotVersion: 2,
        }),
      ],
    });
    useUpdateResults([
      { affectedRows: 1 },
      { affectedRows: 1 },
      { affectedRows: 0 },
    ]);

    const result = await processFormSchedule("form-1", now);

    expect(result).toEqual({
      processed: true,
      statusChanged: true,
      newStatus: "PUBLISHED",
      message: "Form automatically published based on schedule",
    });
    expect(mocks.activateSnapshot).not.toHaveBeenCalled();
  });

  it("marks a SWITCH_SNAPSHOT schedule with no snapshotVersion as processed", async () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    useSelectRows({
      formStatus: "PUBLISHED",
      schedules: [
        scheduleRow({
          id: "schedule-switch",
          action: "SWITCH_SNAPSHOT",
          snapshotVersion: null,
        }),
      ],
    });
    useUpdateResults([{ affectedRows: 1 }]);

    const result = await processFormSchedule("form-1", now);

    expect(result).toEqual({
      processed: true,
      statusChanged: false,
      newStatus: "PUBLISHED",
      message: "SWITCH_SNAPSHOT schedule missing snapshotVersion; skipped",
    });
    expect(mocks.activateSnapshot).not.toHaveBeenCalled();
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]?.table).toBe(mocks.schema.formSchedule);
    expect(mocks.updateCalls[0]?.values).toEqual({ processedAt: now });
  });

  it("releases only its SWITCH_SNAPSHOT claim when activation fails", async () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    useSelectRows({
      formStatus: "PUBLISHED",
      schedules: [
        scheduleRow({
          id: "schedule-switch",
          action: "SWITCH_SNAPSHOT",
          snapshotVersion: 2,
        }),
      ],
    });
    useUpdateResults([{ affectedRows: 1 }, { affectedRows: 1 }]);
    mocks.activateSnapshot.mockRejectedValueOnce(new Error("activate failed"));

    await expect(processFormSchedule("form-1", now)).rejects.toThrow(
      "activate failed",
    );

    expect(mocks.updateCalls).toHaveLength(2);
    expect(mocks.updateCalls[0]?.table).toBe(mocks.schema.formSchedule);
    expect(mocks.updateCalls[0]?.values).toEqual({ processedAt: now });
    expect(mocks.updateCalls[1]?.table).toBe(mocks.schema.formSchedule);
    expect(mocks.updateCalls[1]?.values).toEqual({ processedAt: null });
    expect(mocks.updateCalls[1]?.condition).toEqual({
      type: "and",
      conditions: [
        { type: "eq", left: "formSchedule.id", right: "schedule-switch" },
        { type: "eq", left: "formSchedule.processedAt", right: now },
      ],
    });
  });
});
