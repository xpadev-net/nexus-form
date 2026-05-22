import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  formLimit: vi.fn(),
  integrationLimit: vi.fn(),
  insertedLimit: vi.fn(),
  insertValues: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    transaction: vi.fn(async (callback) => {
      let selectCallIndex = 0;
      const select = vi.fn(() => {
        selectCallIndex += 1;
        if (selectCallIndex === 1) {
          return {
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                for: vi.fn(() => ({ limit: mocks.formLimit })),
              })),
            })),
          };
        }

        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit:
                selectCallIndex === 2
                  ? mocks.integrationLimit
                  : mocks.insertedLimit,
            })),
          })),
        };
      });

      return callback({
        select,
        insert: vi.fn(() => ({
          values: mocks.insertValues,
        })),
        update: vi.fn(() => ({
          set: mocks.updateSet,
        })),
      });
    }),
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  form: {
    creatorId: "form.creatorId",
    id: "form.id",
  },
  formIntegration: {
    formId: "formIntegration.formId",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
}));

import { upsertFormIntegrationForCurrentOwner } from "../form-integration-service";

describe("upsertFormIntegrationForCurrentOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.formLimit.mockResolvedValue([{ creatorId: "new-owner-user-id" }]);
    mocks.integrationLimit.mockResolvedValue([]);
    mocks.insertedLimit.mockResolvedValue([
      {
        id: "integration-1",
        formId: "form-1",
        ownerUserId: "new-owner-user-id",
        userId: "new-owner-user-id",
        configJson: JSON.stringify({
          spreadsheetId: "spreadsheet-1",
          sheetName: "Sheet1",
          headerPolicy: "extend",
        }),
        createdAt: new Date("2026-05-21T00:00:00.000Z"),
        updatedAt: new Date("2026-05-21T01:00:00.000Z"),
      },
    ]);
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.updateSet.mockReturnValue({
      where: mocks.updateWhere.mockResolvedValue(undefined),
    });
  });

  it("locks the form row and inserts integration ownership from current creatorId", async () => {
    const result = await upsertFormIntegrationForCurrentOwner({
      formId: "form-1",
      config: {
        spreadsheetId: "spreadsheet-1",
        sheetName: "Sheet1",
        headerPolicy: "extend",
      },
    });

    expect(result).toMatchObject({
      formId: "form-1",
      ownerUserId: "new-owner-user-id",
      userId: "new-owner-user-id",
    });
    expect(mocks.eq).toHaveBeenCalledWith("form.id", "form-1");
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        formId: "form-1",
        ownerUserId: "new-owner-user-id",
        userId: "new-owner-user-id",
      }),
    );
  });

  it("updates existing integration ownership from current creatorId", async () => {
    mocks.integrationLimit.mockResolvedValueOnce([
      {
        id: "integration-1",
        formId: "form-1",
        ownerUserId: "old-owner-user-id",
        userId: "old-owner-user-id",
      },
    ]);

    await upsertFormIntegrationForCurrentOwner({
      formId: "form-1",
      config: {
        spreadsheetId: "spreadsheet-1",
        sheetName: "Sheet1",
        headerPolicy: "extend",
      },
    });

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "new-owner-user-id",
        userId: "new-owner-user-id",
      }),
    );
  });

  it("returns null when the form no longer exists", async () => {
    mocks.formLimit.mockResolvedValueOnce([]);

    await expect(
      upsertFormIntegrationForCurrentOwner({
        formId: "missing-form",
        config: {
          spreadsheetId: "spreadsheet-1",
          sheetName: "Sheet1",
          headerPolicy: "extend",
        },
      }),
    ).resolves.toBeNull();
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });
});
