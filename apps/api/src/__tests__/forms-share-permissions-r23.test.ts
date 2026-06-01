import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const passThrough = async (
  _c: unknown,
  next: () => Promise<void>,
): Promise<void> => {
  await next();
};

const userSummary = {
  id: "target-user",
  name: "Target User",
  email: "target@example.com",
  discord_id: null,
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
};

const permissionResponse = (role: "EDITOR" | "VIEWER") => ({
  id: "permission-1",
  form_id: "form-1",
  user_id: "target-user",
  role,
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
  user: userSummary,
});

const invitationResponse = {
  id: "invitation-1",
  form_id: "form-1",
  email: "target@example.com",
  role: "VIEWER",
  token: "invite-token",
  status: "PENDING",
  message: "Please review",
  expires_at: "2026-06-08T00:00:00.000Z",
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
  invited_by: "editor-1",
  inviter: {
    id: "editor-1",
    name: "Editor User",
    email: "editor@example.com",
    discord_id: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  },
};

type MockPermissionRole = "OWNER" | "EDITOR" | "VIEWER";

const mocks = vi.hoisted(() => ({
  authContext: null as {
    auth_type: "api_token" | "session";
    user_id: string;
    form_ids?: string[];
  } | null,
  createInvitation: vi.fn(),
  getUserFormPermission: vi.fn(),
  permissionRoles: new Map<string, MockPermissionRole>(),
  removePermission: vi.fn(),
  updatePermissionRole: vi.fn(),
  validateShareLink: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {},
  user: {
    createdAt: "user.createdAt",
    email: "user.email",
    id: "user.id",
    name: "user.name",
    updatedAt: "user.updatedAt",
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  externalServiceValidationResult: {},
  fingerprintDetail: {},
  form: {
    allowEditResponses: "form.allowEditResponses",
    baseSnapshotVersion: "form.baseSnapshotVersion",
    createdAt: "form.createdAt",
    creatorId: "form.creatorId",
    description: "form.description",
    id: "form.id",
    plateContent: "form.plateContent",
    plateContentVersion: "form.plateContentVersion",
    publicId: "form.publicId",
    publishedAt: "form.publishedAt",
    status: "form.status",
    title: "form.title",
    unpublishedAt: "form.unpublishedAt",
    updatedAt: "form.updatedAt",
    version: "form.version",
  },
  formIntegration: {},
  formInvitation: {
    formId: "formInvitation.formId",
    id: "formInvitation.id",
    invitedBy: "formInvitation.invitedBy",
  },
  formPermission: {},
  formResponse: {},
  formSchedule: {
    id: "formSchedule.id",
    formId: "formSchedule.formId",
    processedAt: "formSchedule.processedAt",
    triggerAt: "formSchedule.triggerAt",
  },
  formShareLink: {},
}));

vi.mock("@nexus-form/integrations", () => ({
  providerRegistry: {
    getProvider: vi.fn(),
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  count: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  lte: vi.fn(),
}));

const roleRank: Record<MockPermissionRole, number> = {
  OWNER: 3,
  EDITOR: 2,
  VIEWER: 1,
};

type MockHonoContext = {
  json: (body: unknown, status?: number) => Response;
  set: (
    key: string,
    value: MockPermissionRole | NonNullable<typeof mocks.authContext>,
  ) => void;
};

vi.mock("../lib/dual-auth", () => ({
  withDualAuth: () => async (c: MockHonoContext, next: () => Promise<void>) => {
    if (mocks.authContext) {
      c.set("dualAuthContext", mocks.authContext);
    }
    await next();
  },
  withDualFormAuth:
    (requiredRole: MockPermissionRole = "VIEWER") =>
    async (c: MockHonoContext, next: () => Promise<void>) => {
      if (!mocks.authContext) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const role = mocks.permissionRoles.get(mocks.authContext.user_id);
      if (!role || roleRank[role] < roleRank[requiredRole]) {
        return c.json(
          {
            error: {
              code: "INSUFFICIENT_PERMISSIONS",
              message: "Insufficient permissions",
            },
          },
          403,
        );
      }
      c.set("dualAuthContext", mocks.authContext);
      c.set("dualAuthFormRole", role);
      await next();
    },
}));

vi.mock("../lib/forms/permission-service", () => ({
  acceptInvitation: vi.fn(),
  cancelInvitation: vi.fn(),
  createInvitation: mocks.createInvitation,
  createShareLink: vi.fn(),
  deleteShareLink: vi.fn(),
  getFormInvitations: vi.fn(),
  getFormPermissions: vi.fn(),
  getShareLinks: vi.fn(),
  getUserFormPermission: mocks.getUserFormPermission,
  PermissionRemovalError: class PermissionRemovalError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.name = "PermissionRemovalError";
      this.code = code;
    }
  },
  removePermission: mocks.removePermission,
  transferOwnership: vi.fn(),
  updatePermissionRole: mocks.updatePermissionRole,
  updateShareLink: vi.fn(),
  validateShareLink: mocks.validateShareLink,
  validateShareLinkRole: vi.fn(),
}));

vi.mock("../lib/rate-limit", () => ({
  createRateLimit: () => passThrough,
  getClientIp: () => "127.0.0.1",
}));

vi.mock("../lib/forms/parse-stored-structure", () => ({
  parseStoredStructure: vi.fn(),
}));
vi.mock("../lib/forms/plate-question-builder", () => ({
  buildQuestionsFromPlateContentStrict: vi.fn(),
  PlateQuestionBuildError: class PlateQuestionBuildError extends Error {},
}));
vi.mock("../lib/forms/public-structure", () => ({
  buildPublicFormStructure: vi.fn(),
}));
vi.mock("../lib/forms/response-validator", () => ({
  validateResponseData: vi.fn(),
}));
vi.mock("../lib/forms/schedule-error-logging", () => ({
  logFormScheduleError: vi.fn(),
}));
vi.mock("../lib/forms/schedule-processor", () => ({
  processFormSchedule: vi.fn(),
}));
vi.mock("../lib/forms/snapshot-repository", () => ({
  getLatestSnapshot: vi.fn(),
}));
vi.mock("../lib/forms/validation-rule-repository", () => ({
  parseValidationRuleSnapshot: vi.fn(),
}));
vi.mock("../lib/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));
vi.mock("../lib/queues", () => ({
  getSheetsSyncQueue: vi.fn(),
  getValidationQueue: vi.fn(),
  isValidServiceName: vi.fn(),
}));
vi.mock("../lib/request-body-size-limit", () => ({
  createRequestBodySizeLimit: () => passThrough,
}));
vi.mock("../lib/response-data-json", () => ({
  stringifyResponseDataJson: vi.fn(),
}));
vi.mock("../lib/security/form-security-bypass", () => ({
  isFormSecurityBypassEnabled: vi.fn(),
}));
vi.mock("../lib/security/hcaptcha", () => ({
  verifyHCaptcha: vi.fn(),
}));
vi.mock("../lib/security/password", () => ({
  verifyPassword: vi.fn(),
}));
vi.mock("../lib/sentry", () => ({
  captureError: vi.fn(),
}));
vi.mock("../lib/sessions/jwt", () => ({
  extractJwtFromRequest: vi.fn(),
  resolveSessionIdOrCreate: vi.fn(),
  signSessionJwt: vi.fn(),
  verifySessionJwt: vi.fn(),
}));
vi.mock("../lib/telemetry/tokens", () => ({
  consumeTokensOrThrow: vi.fn(),
}));

const { createHonoApp } = await import("../lib/hono");
const { formsPermissionsRouter } = await import("../routes/forms-permissions");
const { formsPublicRouter } = await import("../routes/forms-public");

function createApp() {
  return createHonoApp()
    .route("/api/forms", formsPublicRouter)
    .route("/api/forms", formsPermissionsRouter);
}

describe("R23-T3 share and permission routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authContext = { auth_type: "session", user_id: "editor-1" };
    mocks.permissionRoles.clear();
    mocks.permissionRoles.set("editor-1", "EDITOR");
    mocks.permissionRoles.set("owner-1", "OWNER");
    mocks.permissionRoles.set("target-user", "EDITOR");
    mocks.createInvitation.mockResolvedValue(invitationResponse);
    mocks.getUserFormPermission.mockResolvedValue("EDITOR");
    mocks.removePermission.mockResolvedValue(undefined);
    mocks.updatePermissionRole.mockResolvedValue(permissionResponse("VIEWER"));
    mocks.validateShareLink.mockResolvedValue({
      form: {
        id: "form-1",
        title: "Shared Form",
        description: "Shared description",
      },
      role: "VIEWER",
      share_link: {
        id: "link-1",
        form_id: "form-1",
        token: "secret-token",
        role: "VIEWER",
        is_active: true,
        expires_at: undefined,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
        created_by: "editor-1",
      },
    });
  });

  it.each([
    "VIEWER",
    "EDITOR",
  ] as const)("returns a shared-link view for %s without exposing the raw token", async (role) => {
    mocks.validateShareLink.mockResolvedValueOnce({
      form: {
        id: "form-1",
        title: "Shared Form",
        description: "Shared description",
      },
      role,
      share_link: {
        id: "link-1",
        form_id: "form-1",
        token: "secret-token",
        role,
        is_active: true,
        expires_at: undefined,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
        created_by: "editor-1",
      },
    });
    const app = createApp();

    const response = await app.request("/api/forms/shared/secret-token");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      form: {
        id: "form-1",
        title: "Shared Form",
        description: "Shared description",
      },
      role,
      share_link: {
        id: "link-1",
        form_id: "form-1",
        role,
        is_active: true,
        created_at: "2026-06-01T00:00:00.000Z",
        updated_at: "2026-06-01T00:00:00.000Z",
        created_by: "editor-1",
      },
    });
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(mocks.validateShareLink).toHaveBeenCalledWith("secret-token");
  });

  it("creates an email invitation through the mocked invitation service", async () => {
    const app = createApp();

    const response = await app.request("/api/forms/form-1/invitations", {
      body: JSON.stringify({
        email: "target@example.com",
        role: "VIEWER",
        message: "Please review",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      invitation: invitationResponse,
    });
    expect(mocks.createInvitation).toHaveBeenCalledWith(
      "form-1",
      "target@example.com",
      "VIEWER",
      "editor-1",
      "Please review",
      undefined,
    );
  });

  it("downgrades another user's EDITOR permission to VIEWER", async () => {
    const app = createApp();
    mocks.authContext = { auth_type: "session", user_id: "owner-1" };

    const response = await app.request(
      "/api/forms/form-1/permissions/target-user",
      {
        body: JSON.stringify({ role: "VIEWER" }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      permission: permissionResponse("VIEWER"),
    });
    expect(mocks.updatePermissionRole).toHaveBeenCalledWith(
      "form-1",
      "target-user",
      "VIEWER",
    );
  });

  it("shows EDITOR before removal and null after permission deletion", async () => {
    const app = createApp();
    mocks.getUserFormPermission.mockResolvedValueOnce("EDITOR");
    mocks.removePermission.mockImplementationOnce(async () => {
      mocks.permissionRoles.delete("target-user");
    });

    mocks.authContext = { auth_type: "session", user_id: "target-user" };
    const beforeRemoval = await app.request("/api/forms/form-1/permissions/me");

    mocks.authContext = { auth_type: "session", user_id: "owner-1" };
    const removal = await app.request(
      "/api/forms/form-1/permissions/target-user",
      { method: "DELETE" },
    );

    mocks.authContext = { auth_type: "session", user_id: "target-user" };
    const afterRemoval = await app.request("/api/forms/form-1/permissions/me");

    expect(beforeRemoval.status).toBe(200);
    await expect(beforeRemoval.json()).resolves.toEqual({ role: "EDITOR" });
    expect(removal.status).toBe(200);
    await expect(removal.json()).resolves.toEqual({ ok: true });
    expect(afterRemoval.status).toBe(403);
    await expect(afterRemoval.json()).resolves.toMatchObject({
      error: {
        code: "INSUFFICIENT_PERMISSIONS",
        message: "Insufficient permissions",
      },
    });
    expect(mocks.removePermission).toHaveBeenCalledWith(
      "form-1",
      "target-user",
    );
  });
});
