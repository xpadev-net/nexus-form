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
  deleteShareLink: vi.fn(),
  getShareLinks: vi.fn(),
  updateShareLink: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: mocks.dbSelect,
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
  formPermission: {},
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
  checkShareLinkPermission: vi.fn(),
  createInvitation: vi.fn(),
  createShareLink: mocks.createShareLink,
  deleteShareLink: mocks.deleteShareLink,
  getFormInvitations: vi.fn(),
  getFormPermissions: vi.fn(),
  getShareLinks: mocks.getShareLinks,
  getUserFormPermission: vi.fn(),
  transferOwnership: vi.fn(),
  updatePermissionRole: vi.fn(),
  updateShareLink: mocks.updateShareLink,
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
});
