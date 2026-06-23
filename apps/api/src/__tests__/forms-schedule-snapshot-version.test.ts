import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
  insertValues: vi.fn(),
}));

vi.mock("../load-env", () => ({}));

vi.mock("@nexus-form/database", () => ({
  db: mocks.db,
}));

vi.mock("@nexus-form/database/schema", () => ({
  formSchedule: {
    id: "formSchedule.id",
    formId: "formSchedule.formId",
    triggerAt: "formSchedule.triggerAt",
    action: "formSchedule.action",
    snapshotVersion: "formSchedule.snapshotVersion",
    processedAt: "formSchedule.processedAt",
    createdAt: "formSchedule.createdAt",
    updatedAt: "formSchedule.updatedAt",
  },
  formSnapshot: {
    id: "formSnapshot.id",
    formId: "formSnapshot.formId",
    version: "formSnapshot.version",
  },
}));

vi.mock("../lib/dual-auth", () => ({
  withDualFormAuth: () => {
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", {
        auth_type: "session",
        user_id: "user-1",
      });
      await next();
    };
  },
}));

vi.mock("../lib/rate-limit", () => ({
  createRateLimit: () => {
    return async (_c: unknown, next: () => Promise<void>) => next();
  },
  getClientIp: () => "127.0.0.1",
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ type: "and", conditions })),
  asc: vi.fn((column: unknown) => ({ type: "asc", column })),
  count: vi.fn(() => ({ type: "count" })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
  isNull: vi.fn((column: unknown) => ({ type: "isNull", column })),
}));

type ScheduleRow = {
  id: string;
  formId: string;
  triggerAt: Date;
  action: "PUBLISH" | "UNPUBLISH" | "SWITCH_SNAPSHOT";
  snapshotVersion: number | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function selectLimitQuery(result: unknown[]) {
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    limit: vi.fn(() => Promise.resolve(result)),
  };
  return query;
}

function updateQuery(affectedRows = 1) {
  const query = {
    set: vi.fn(() => query),
    where: vi.fn(() => Promise.resolve([{ affectedRows }])),
  };
  return query;
}

function scheduleRow(overrides: Partial<ScheduleRow> = {}): ScheduleRow {
  const now = new Date("2026-06-01T00:00:00.000Z");
  return {
    id: "schedule-1",
    formId: "form-1",
    triggerAt: new Date("2099-01-01T00:00:00.000Z"),
    action: "SWITCH_SNAPSHOT",
    snapshotVersion: 2,
    processedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("forms schedule snapshot version validation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.db.insert.mockReturnValue({ values: mocks.insertValues });
    mocks.db.select.mockReset();
    mocks.db.update.mockReset();
  });

  it("rejects creating a SWITCH_SNAPSHOT schedule for a missing snapshot", async () => {
    mocks.db.select.mockReturnValueOnce(selectLimitQuery([]));
    const { formsScheduleRouter } = await import("../routes/forms-schedule");

    const res = await formsScheduleRouter.request("/form-1/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triggerAt: "2099-01-01T00:00:00.000Z",
        action: "SWITCH_SNAPSHOT",
        snapshotVersion: 99,
      }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "Snapshot not found",
    });
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it("creates a SWITCH_SNAPSHOT schedule when the snapshot exists", async () => {
    mocks.db.select
      .mockReturnValueOnce(selectLimitQuery([{ id: "snapshot-2" }]))
      .mockReturnValueOnce(selectLimitQuery([scheduleRow()]));
    const { formsScheduleRouter } = await import("../routes/forms-schedule");

    const res = await formsScheduleRouter.request("/form-1/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        triggerAt: "2099-01-01T00:00:00.000Z",
        action: "SWITCH_SNAPSHOT",
        snapshotVersion: 2,
      }),
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      schedule: {
        id: "schedule-1",
        action: "SWITCH_SNAPSHOT",
        snapshotVersion: 2,
      },
    });
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        formId: "form-1",
        action: "SWITCH_SNAPSHOT",
        snapshotVersion: 2,
      }),
    );
  });

  it("rejects updating a schedule to a missing snapshot version", async () => {
    mocks.db.select
      .mockReturnValueOnce(
        selectLimitQuery([scheduleRow({ action: "PUBLISH" })]),
      )
      .mockReturnValueOnce(selectLimitQuery([]));
    mocks.db.update.mockReturnValue(updateQuery());
    const { formsScheduleRouter } = await import("../routes/forms-schedule");

    const res = await formsScheduleRouter.request(
      "/form-1/schedule/schedule-1",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "SWITCH_SNAPSHOT",
          snapshotVersion: 99,
        }),
      },
    );

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "Snapshot not found",
    });
    expect(mocks.db.update).not.toHaveBeenCalled();
  });
});
