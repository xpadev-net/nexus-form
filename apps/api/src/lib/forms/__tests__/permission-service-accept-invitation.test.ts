import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  transaction: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    transaction: mocks.transaction,
  },
  user: {
    email: "user.email",
    id: "user.id",
    name: "user.name",
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  form: {
    creatorId: "form.creatorId",
    id: "form.id",
  },
  formIntegration: {},
  formInvitation: {
    expiresAt: "formInvitation.expiresAt",
    formId: "formInvitation.formId",
    id: "formInvitation.id",
    invitedBy: "formInvitation.invitedBy",
    status: "formInvitation.status",
    token: "formInvitation.token",
  },
  formPermission: {
    createdAt: "formPermission.createdAt",
    formId: "formPermission.formId",
    id: "formPermission.id",
    role: "formPermission.role",
    updatedAt: "formPermission.updatedAt",
    userId: "formPermission.userId",
  },
  formShareLink: {},
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  count: vi.fn(),
  desc: vi.fn(),
  eq: mocks.eq,
  inArray: vi.fn(),
}));

type SelectOptions = {
  join?: boolean;
  lock?: boolean;
};

function createSelectQuery(rows: unknown[], options: SelectOptions = {}) {
  const limit = vi.fn().mockResolvedValue(rows);
  const lock = vi.fn(() => ({ limit }));
  const whereResult = options.lock ? { for: lock } : { limit };
  const where = vi.fn(() => whereResult);
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => (options.join ? { innerJoin } : { where }));
  return { from, innerJoin, limit, lock, where };
}

function createTx() {
  const selectQueue: ReturnType<typeof createSelectQuery>[] = [];
  const updateResults: Array<Array<{ affectedRows: number }>> = [];
  const updateSets: unknown[] = [];
  const insertValues: unknown[] = [];

  return {
    insertValues,
    selectQueue,
    updateResults,
    updateSets,
    tx: {
      insert: vi.fn(() => ({
        values: vi.fn(async (value: unknown) => {
          insertValues.push(value);
        }),
      })),
      select: vi.fn(() => {
        const query = selectQueue.shift();
        if (!query) {
          throw new Error("Unexpected select query");
        }
        return query;
      }),
      update: vi.fn(() => ({
        set: vi.fn((value: unknown) => {
          updateSets.push(value);
          return {
            where: vi.fn(
              async () => updateResults.shift() ?? [{ affectedRows: 1 }],
            ),
          };
        }),
      })),
    },
  };
}

function permissionRow(role: "EDITOR" | "VIEWER" = "VIEWER") {
  return {
    createdAt: new Date("2026-05-21T00:00:00.000Z"),
    formId: "form-1",
    id: `permission-${role.toLowerCase()}`,
    role,
    updatedAt: new Date("2026-05-21T01:00:00.000Z"),
    userEmail: "invitee@example.com",
    userId: "invitee-1",
    userName: "Invitee",
  };
}

function pendingInvitation() {
  return {
    email: "invitee@example.com",
    expiresAt: new Date("2026-12-31T00:00:00.000Z"),
    formId: "form-1",
    id: "invitation-1",
    invitedBy: "editor-1",
    role: "VIEWER",
    status: "PENDING",
  };
}

import { acceptInvitation } from "../permission-service";

describe("acceptInvitation authority and race handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txQueue.length = 0;
    mocks.transaction.mockImplementation(async (callback) => {
      const nextTx = txQueue.shift();
      if (!nextTx) {
        throw new Error("Unexpected transaction");
      }
      return callback(nextTx.tx);
    });
  });

  const txQueue: ReturnType<typeof createTx>[] = [];

  it("revalidates inviter authority and accepts a pending invitation with a CAS update", async () => {
    const tx = createTx();
    tx.selectQueue.push(
      createSelectQuery([pendingInvitation()], { lock: true }),
      createSelectQuery([{ email: "invitee@example.com", id: "invitee-1" }]),
      createSelectQuery([{ creatorId: "owner-1" }]),
      createSelectQuery([{ role: "EDITOR" }], { lock: true }),
      createSelectQuery([]),
      createSelectQuery([permissionRow()], { join: true }),
    );
    tx.updateResults.push([{ affectedRows: 1 }]);
    txQueue.push(tx);

    const permission = await acceptInvitation(
      "abcdefghijklmnopqrstuvwxyzABCDEFG0123456789_-",
      "invitee-1",
    );

    expect(permission.user_id).toBe("invitee-1");
    expect(permission.role).toBe("VIEWER");
    expect(tx.updateSets).toContainEqual({ status: "ACCEPTED" });
    expect(tx.insertValues).toHaveLength(1);
    expect(mocks.eq).toHaveBeenCalledWith("formInvitation.status", "PENDING");
    expect(mocks.eq).toHaveBeenCalledWith("formPermission.userId", "editor-1");
  });

  it("rejects acceptance when the inviter has been downgraded or removed", async () => {
    const tx = createTx();
    tx.selectQueue.push(
      createSelectQuery([pendingInvitation()], { lock: true }),
      createSelectQuery([{ email: "invitee@example.com", id: "invitee-1" }]),
      createSelectQuery([{ creatorId: "owner-1" }]),
      createSelectQuery([{ role: "VIEWER" }], { lock: true }),
    );
    txQueue.push(tx);

    await expect(
      acceptInvitation(
        "abcdefghijklmnopqrstuvwxyzABCDEFG0123456789_-",
        "invitee-1",
      ),
    ).rejects.toMatchObject({
      code: "INVITER_PERMISSION_REVOKED",
      statusCode: 403,
    });
  });

  it("returns 410 when a pending invitation was cancelled after permission removal or downgrade", async () => {
    const tx = createTx();
    tx.selectQueue.push(
      createSelectQuery(
        [
          {
            ...pendingInvitation(),
            status: "CANCELLED",
          },
        ],
        { lock: true },
      ),
      createSelectQuery([{ email: "invitee@example.com", id: "invitee-1" }]),
    );
    txQueue.push(tx);

    await expect(
      acceptInvitation(
        "abcdefghijklmnopqrstuvwxyzABCDEFG0123456789_-",
        "invitee-1",
      ),
    ).rejects.toMatchObject({
      code: "INVITATION_NOT_PENDING",
      statusCode: 410,
    });
  });

  it("treats double-click or two-tab accepts as idempotent success after the first acceptance wins", async () => {
    const firstTx = createTx();
    firstTx.selectQueue.push(
      createSelectQuery([pendingInvitation()], { lock: true }),
      createSelectQuery([{ email: "invitee@example.com", id: "invitee-1" }]),
      createSelectQuery([{ creatorId: "owner-1" }]),
      createSelectQuery([{ role: "EDITOR" }], { lock: true }),
      createSelectQuery([]),
      createSelectQuery([permissionRow()], { join: true }),
    );
    firstTx.updateResults.push([{ affectedRows: 1 }]);

    const secondTx = createTx();
    secondTx.selectQueue.push(
      createSelectQuery(
        [
          {
            ...pendingInvitation(),
            status: "ACCEPTED",
          },
        ],
        { lock: true },
      ),
      createSelectQuery([{ email: "invitee@example.com", id: "invitee-1" }]),
      createSelectQuery([permissionRow()], { join: true }),
    );

    txQueue.push(firstTx, secondTx);

    const [first, second] = await Promise.all([
      acceptInvitation(
        "abcdefghijklmnopqrstuvwxyzABCDEFG0123456789_-",
        "invitee-1",
      ),
      acceptInvitation(
        "abcdefghijklmnopqrstuvwxyzABCDEFG0123456789_-",
        "invitee-1",
      ),
    ]);

    expect(first).toEqual(second);
    expect(firstTx.insertValues).toHaveLength(1);
    expect(secondTx.insertValues).toHaveLength(0);
    expect(secondTx.updateSets).toHaveLength(0);
  });
});
