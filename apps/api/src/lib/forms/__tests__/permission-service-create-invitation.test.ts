import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  selectLimit: vi.fn(),
  txDelete: vi.fn(),
  txDeleteWhere: vi.fn(),
  txInsert: vi.fn(),
  txInsertValues: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    transaction: vi.fn(async (callback) =>
      callback({
        delete: mocks.txDelete,
        insert: mocks.txInsert,
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({ limit: mocks.selectLimit })),
          })),
        })),
      }),
    ),
  },
  user: {
    email: "user.email",
    id: "user.id",
    name: "user.name",
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  form: {
    id: "form.id",
  },
  formIntegration: {},
  formInvitation: {
    email: "formInvitation.email",
    formId: "formInvitation.formId",
    id: "formInvitation.id",
    status: "formInvitation.status",
    token: "formInvitation.token",
  },
  formPermission: {},
  formShareLink: {},
}));

vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  count: vi.fn(),
  desc: vi.fn(),
  eq: mocks.eq,
  inArray: vi.fn(),
}));

import { createInvitation, InvitationCreateError } from "../permission-service";

describe("createInvitation duplicate pending protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.txDelete.mockReturnValue({ where: mocks.txDeleteWhere });
    mocks.txInsert.mockReturnValue({ values: mocks.txInsertValues });
    mocks.txInsertValues.mockResolvedValue(undefined);
  });

  it("returns forbidden before inserting when the inviter user does not exist", async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: "form-1" }])
      .mockResolvedValueOnce([]);

    const result = createInvitation(
      "form-1",
      "target@example.com",
      "VIEWER",
      "share-link:link-1",
    );

    await expect(result).rejects.toMatchObject({
      code: "INVITER_NOT_FOUND",
      statusCode: 403,
      message: "Inviter is not allowed to create invitations",
    });
    expect(mocks.txInsert).not.toHaveBeenCalled();
  });

  it("returns a conflict before replacing a pending invitation for the same email", async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: "form-1" }])
      .mockResolvedValueOnce([
        {
          email: "editor@example.com",
          id: "editor-1",
          name: "Editor",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "invitation-1",
          status: "PENDING",
        },
      ]);

    const result = createInvitation(
      "form-1",
      "target@example.com",
      "VIEWER",
      "editor-1",
    );

    await expect(result).rejects.toBeInstanceOf(InvitationCreateError);
    await expect(result).rejects.toMatchObject({
      code: "INVITATION_ALREADY_EXISTS",
      statusCode: 409,
      message: "Invitation already exists for this email",
    });
    expect(mocks.txDelete).not.toHaveBeenCalled();
    expect(mocks.txInsert).not.toHaveBeenCalled();
  });

  it("maps concurrent duplicate insert failures to conflict responses", async () => {
    mocks.selectLimit
      .mockResolvedValueOnce([{ id: "form-1" }])
      .mockResolvedValueOnce([
        {
          email: "editor@example.com",
          id: "editor-1",
          name: "Editor",
        },
      ])
      .mockResolvedValueOnce([]);
    const duplicateKeyError = Object.assign(
      new Error(
        "Duplicate entry 'form-1-target@example.com' for key 'FormInvitation_formId_email_key'",
      ),
      { code: "ER_DUP_ENTRY", errno: 1062 },
    );
    mocks.txInsertValues.mockRejectedValue(
      new Error("Failed query: insert into FormInvitation", {
        cause: duplicateKeyError,
      }),
    );

    const result = createInvitation(
      "form-1",
      "target@example.com",
      "VIEWER",
      "editor-1",
    );

    await expect(result).rejects.toMatchObject({
      code: "INVITATION_ALREADY_EXISTS",
      statusCode: 409,
      message: "Invitation already exists for this email",
    });
    expect(mocks.txInsertValues).toHaveBeenCalledTimes(1);
  });
});
