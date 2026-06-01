import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  authContext: null as {
    auth_type: "api_token" | "session";
    user_id: string;
    token_id?: string;
    scopes?: string[];
    form_ids?: string[];
    share_link_id?: string;
  } | null,
  createShareLink: vi.fn(),
  dbSelect: vi.fn(),
  dbTransaction: vi.fn(),
  deleteShareLink: vi.fn(),
  checkShareLinkPermission: vi.fn(),
  getUserFormPermission: vi.fn(),
  getFormPermissions: vi.fn(),
  getShareLinks: vi.fn(),
  permissionLookupLimit: vi.fn(),
  PermissionRemovalError: class PermissionRemovalError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.name = "PermissionRemovalError";
      this.code = code;
    }
  },
  removePermission: vi.fn(),
  txInsert: vi.fn(),
  txInsertValues: vi.fn(),
  updateShareLink: vi.fn(),
  userLookupLimit: vi.fn(),
  validateShareLinkRole: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: mocks.dbSelect,
    transaction: mocks.dbTransaction,
  },
  user: {
    id: "user.id",
    name: "user.name",
    email: "user.email",
    createdAt: "user.createdAt",
    updatedAt: "user.updatedAt",
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  formInvitation: {},
  formPermission: {
    formId: "formPermission.formId",
    id: "formPermission.id",
    userId: "formPermission.userId",
  },
  formShareLink: {
    id: "formShareLink.id",
    formId: "formShareLink.formId",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("../lib/dual-auth", () => ({
  withDualAuth: () => {
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", mocks.authContext);
      await next();
    };
  },
  withDualFormAuth: () => {
    return async (
      c: { set: (key: string, value: unknown) => void },
      next: () => Promise<void>,
    ) => {
      c.set("dualAuthContext", mocks.authContext);
      await next();
    };
  },
}));

vi.mock("../lib/forms/permission-service", () => ({
  acceptInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
  checkShareLinkPermission: mocks.checkShareLinkPermission,
  createInvitation: vi.fn(),
  createShareLink: mocks.createShareLink,
  deleteShareLink: mocks.deleteShareLink,
  getFormInvitations: vi.fn(),
  getFormPermissions: mocks.getFormPermissions,
  getShareLinks: mocks.getShareLinks,
  getUserFormPermission: mocks.getUserFormPermission,
  PermissionRemovalError: mocks.PermissionRemovalError,
  removePermission: mocks.removePermission,
  transferOwnership: vi.fn(),
  updatePermissionRole: vi.fn(),
  updateShareLink: mocks.updateShareLink,
  validateShareLinkRole: mocks.validateShareLinkRole,
}));

describe("R9-C1 share-link management authorization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getShareLinks.mockResolvedValue({
      share_links: [
        {
          id: "managed-link",
          form_id: "form-1",
          token: "secret-share-token",
          role: "EDITOR",
          is_active: true,
          created_at: "2026-05-21T00:00:00.000Z",
          updated_at: "2026-05-21T00:00:00.000Z",
          created_by: "owner-1",
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    });
    mocks.checkShareLinkPermission.mockResolvedValue(true);
    mocks.getUserFormPermission.mockResolvedValue("VIEWER");
    mocks.validateShareLinkRole.mockReturnValue(true);
    mocks.createShareLink.mockResolvedValue({
      id: "new-link",
      form_id: "form-1",
      token: "new-share-token",
      role: "VIEWER",
      is_active: true,
      created_at: "2026-05-21T00:00:00.000Z",
      updated_at: "2026-05-21T00:00:00.000Z",
      created_by: "editor-1",
    });
  });

  it("rejects share-link API tokens before listing managed share links", async () => {
    mocks.authContext = {
      auth_type: "api_token",
      user_id: "share-link:link-1",
      token_id: "token-1",
      scopes: ["read", "write"],
      form_ids: ["form-1"],
      share_link_id: "link-1",
    };

    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );
    const response = await formsPermissionsRouter.request(
      "/form-1/share-links?page=1&pageSize=20",
    );
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(body).not.toContain("secret-share-token");
    expect(mocks.getShareLinks).not.toHaveBeenCalled();
  });

  it.each([
    {
      method: "GET",
      path: "/form-1/share-links/managed-link",
      service: "dbSelect",
    },
    {
      method: "POST",
      path: "/form-1/share-links",
      body: { role: "VIEWER" },
      service: "createShareLink",
    },
    {
      method: "PUT",
      path: "/form-1/share-links/managed-link",
      body: { isActive: false },
      service: "updateShareLink",
    },
    {
      method: "DELETE",
      path: "/form-1/share-links/managed-link",
      service: "deleteShareLink",
    },
  ] as const)("rejects share-link API tokens before $method $path", async ({
    body,
    method,
    path,
    service,
  }) => {
    mocks.authContext = {
      auth_type: "api_token",
      user_id: "share-link:link-1",
      token_id: "token-1",
      scopes: ["read", "write"],
      form_ids: ["form-1"],
      share_link_id: "link-1",
    };

    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );
    const response = await formsPermissionsRouter.request(path, {
      body: body ? JSON.stringify(body) : undefined,
      headers: body ? { "content-type": "application/json" } : undefined,
      method,
    });

    expect(response.status).toBe(403);
    expect(mocks[service]).not.toHaveBeenCalled();
  });

  it("rejects anonymous synthetic API tokens before listing managed share links", async () => {
    mocks.authContext = {
      auth_type: "api_token",
      user_id: "anon:visitor-1",
      token_id: "token-1",
      scopes: ["read"],
      form_ids: ["form-1"],
    };

    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );
    const response = await formsPermissionsRouter.request(
      "/form-1/share-links?page=1&pageSize=20",
    );

    expect(response.status).toBe(403);
    expect(mocks.getShareLinks).not.toHaveBeenCalled();
  });

  it("allows session users to list managed share links", async () => {
    mocks.authContext = {
      auth_type: "session",
      user_id: "editor-1",
    };

    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );
    const response = await formsPermissionsRouter.request(
      "/form-1/share-links?page=1&pageSize=20",
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("secret-share-token");
    expect(mocks.getShareLinks).toHaveBeenCalledWith(
      "form-1",
      1,
      20,
      undefined,
    );
  });

  it("rejects share-link creation when the requested role exceeds the user's role", async () => {
    mocks.authContext = {
      auth_type: "session",
      user_id: "editor-1",
    };
    mocks.getUserFormPermission.mockResolvedValue("VIEWER");
    mocks.validateShareLinkRole.mockReturnValue(false);

    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );
    const response = await formsPermissionsRouter.request(
      "/form-1/share-links",
      {
        body: JSON.stringify({ role: "EDITOR" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(response.status).toBe(403);
    expect(mocks.validateShareLinkRole).toHaveBeenCalledWith(
      "EDITOR",
      "VIEWER",
    );
    expect(mocks.checkShareLinkPermission).not.toHaveBeenCalled();
    expect(mocks.createShareLink).not.toHaveBeenCalled();
  });

  it("creates share links only after validating the requested role against the current user role", async () => {
    mocks.authContext = {
      auth_type: "session",
      user_id: "editor-1",
    };
    mocks.getUserFormPermission.mockResolvedValue("EDITOR");
    mocks.validateShareLinkRole.mockReturnValue(true);

    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );
    const response = await formsPermissionsRouter.request(
      "/form-1/share-links",
      {
        body: JSON.stringify({ role: "VIEWER" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    expect(response.status).toBe(201);
    expect(mocks.getUserFormPermission).toHaveBeenCalledWith(
      "editor-1",
      "form-1",
      { auth_type: "session", form_ids: undefined },
    );
    expect(mocks.validateShareLinkRole).toHaveBeenCalledWith(
      "VIEWER",
      "EDITOR",
    );
    expect(mocks.checkShareLinkPermission).not.toHaveBeenCalled();
    expect(mocks.createShareLink).toHaveBeenCalledWith(
      "form-1",
      "VIEWER",
      "editor-1",
      undefined,
    );
  });
});

describe("R14-H6 permission creation user existence checks", () => {
  const createdPermission = {
    id: "permission-1",
    form_id: "form-1",
    user_id: "target-user",
    role: "VIEWER",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    user: {
      id: "target-user",
      name: "Target User",
      email: "target@example.com",
      discord_id: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
  };

  const mockPermissionCreationTransaction = ({
    existingPermissionRows,
    userRows,
  }: {
    existingPermissionRows: Array<{ id: string }>;
    userRows: Array<{ id: string }>;
  }) => {
    mocks.userLookupLimit.mockResolvedValue(userRows);
    mocks.permissionLookupLimit.mockResolvedValue(existingPermissionRows);
    mocks.dbTransaction.mockImplementation(
      async (
        callback: (transaction: {
          insert: typeof mocks.txInsert;
          select: () => {
            from: () => {
              where: () => {
                limit:
                  | typeof mocks.userLookupLimit
                  | typeof mocks.permissionLookupLimit;
              };
            };
          };
        }) => Promise<unknown>,
      ) => {
        let selectCount = 0;
        const tx = {
          insert: mocks.txInsert.mockReturnValue({
            values: mocks.txInsertValues,
          }),
          select: () => {
            selectCount += 1;
            return {
              from: () => ({
                where: () => ({
                  limit:
                    selectCount === 1
                      ? mocks.userLookupLimit
                      : mocks.permissionLookupLimit,
                }),
              }),
            };
          },
        };
        return callback(tx);
      },
    );
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.authContext = {
      auth_type: "session",
      user_id: "owner-1",
    };
    mocks.permissionLookupLimit.mockResolvedValue([]);
    mocks.txInsertValues.mockResolvedValue(undefined);
    mocks.getFormPermissions.mockResolvedValue({
      permissions: [createdPermission],
      total: 1,
      page: 1,
      limit: 1,
    });
  });

  it("returns not found instead of inserting when the target user does not exist", async () => {
    mockPermissionCreationTransaction({
      existingPermissionRows: [],
      userRows: [],
    });

    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );
    const response = await formsPermissionsRouter.request(
      "/form-1/permissions",
      {
        body: JSON.stringify({
          role: "VIEWER",
          userId: "missing-user",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    await expect(response.json()).resolves.toEqual({ error: "User not found" });
    expect(response.status).toBe(404);
    expect(mocks.userLookupLimit).toHaveBeenCalledTimes(1);
    expect(mocks.permissionLookupLimit).not.toHaveBeenCalled();
    expect(mocks.txInsert).not.toHaveBeenCalled();
    expect(mocks.txInsertValues).not.toHaveBeenCalled();
    expect(mocks.getFormPermissions).not.toHaveBeenCalled();
  });

  it("returns conflict without inserting when permission already exists", async () => {
    mockPermissionCreationTransaction({
      existingPermissionRows: [{ id: "existing-permission" }],
      userRows: [{ id: "target-user" }],
    });

    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );
    const response = await formsPermissionsRouter.request(
      "/form-1/permissions",
      {
        body: JSON.stringify({
          role: "VIEWER",
          userId: "target-user",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    await expect(response.json()).resolves.toEqual({
      error: "Permission already exists",
    });
    expect(response.status).toBe(409);
    expect(mocks.userLookupLimit).toHaveBeenCalledTimes(1);
    expect(mocks.permissionLookupLimit).toHaveBeenCalledTimes(1);
    expect(mocks.txInsert).not.toHaveBeenCalled();
    expect(mocks.txInsertValues).not.toHaveBeenCalled();
    expect(mocks.getFormPermissions).not.toHaveBeenCalled();
  });

  it("creates a permission after user and duplicate checks pass", async () => {
    mockPermissionCreationTransaction({
      existingPermissionRows: [],
      userRows: [{ id: "target-user" }],
    });

    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );
    const response = await formsPermissionsRouter.request(
      "/form-1/permissions",
      {
        body: JSON.stringify({
          role: "VIEWER",
          userId: "target-user",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );

    await expect(response.json()).resolves.toEqual({
      permission: createdPermission,
    });
    expect(response.status).toBe(201);
    expect(mocks.userLookupLimit).toHaveBeenCalledTimes(1);
    expect(mocks.permissionLookupLimit).toHaveBeenCalledTimes(1);
    expect(mocks.txInsert).toHaveBeenCalledTimes(1);
    expect(mocks.txInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        formId: "form-1",
        role: "VIEWER",
        userId: "target-user",
      }),
    );
    expect(mocks.getFormPermissions).toHaveBeenCalledWith({
      form_id: "form-1",
      page: 1,
      limit: 1,
      user_id: "target-user",
    });
  });
});

describe("R10-C2 permission deletion invariants", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.authContext = {
      auth_type: "session",
      user_id: "owner-1",
    };
    mocks.removePermission.mockResolvedValue(undefined);
  });

  it("deletes non-owner permissions through the permission service", async () => {
    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );

    const response = await formsPermissionsRouter.request(
      "/form-1/permissions/editor-1",
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(mocks.removePermission).toHaveBeenCalledWith("form-1", "editor-1");
  });

  it("maps owner deletion invariant failures to conflict responses", async () => {
    mocks.removePermission.mockRejectedValue(
      new mocks.PermissionRemovalError(
        "OWNER_PERMISSION_REMOVAL_FORBIDDEN",
        "Cannot remove owner permission. Use transfer ownership instead.",
      ),
    );
    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );

    const response = await formsPermissionsRouter.request(
      "/form-1/permissions/owner-2",
      { method: "DELETE" },
    );
    const body = await response.text();

    expect(response.status).toBe(409);
    expect(body).toContain("Cannot remove owner permission");
    expect(mocks.removePermission).toHaveBeenCalledWith("form-1", "owner-2");
  });

  it("maps missing permission failures to not found responses", async () => {
    mocks.removePermission.mockRejectedValue(
      new mocks.PermissionRemovalError(
        "PERMISSION_NOT_FOUND",
        "Permission not found",
      ),
    );
    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );

    const response = await formsPermissionsRouter.request(
      "/form-1/permissions/missing-user",
      { method: "DELETE" },
    );

    expect(response.status).toBe(404);
    expect(mocks.removePermission).toHaveBeenCalledWith(
      "form-1",
      "missing-user",
    );
  });

  it("maps missing form failures to not found responses", async () => {
    mocks.removePermission.mockRejectedValue(
      new mocks.PermissionRemovalError("FORM_NOT_FOUND", "Form not found"),
    );
    const { formsPermissionsRouter } = await import(
      "../routes/forms-permissions"
    );

    const response = await formsPermissionsRouter.request(
      "/missing-form/permissions/editor-1",
      { method: "DELETE" },
    );

    expect(response.status).toBe(404);
    expect(mocks.removePermission).toHaveBeenCalledWith(
      "missing-form",
      "editor-1",
    );
  });
});
