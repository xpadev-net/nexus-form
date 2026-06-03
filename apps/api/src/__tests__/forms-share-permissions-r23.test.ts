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

const r25Users = {
  owner: {
    id: "owner-1",
    role: "OWNER",
    email: "owner@example.com",
  },
  editor: {
    id: "editor-1",
    role: "EDITOR",
    email: "editor@example.com",
  },
  viewer: {
    id: "viewer-1",
    role: "VIEWER",
    email: "viewer@example.com",
  },
  respondent: {
    id: "respondent-1",
    role: null,
    email: "respondent@example.com",
  },
} as const;

const validInviteToken = "abcdefghijklmnopqrstuvwxyzABCDEFG0123456789_-";

const permissionResponseForUser = (
  role: "EDITOR" | "VIEWER",
  userData: { email: string; id: string; name: string },
) => ({
  ...permissionResponse(role),
  user_id: userData.id,
  user: {
    ...userSummary,
    id: userData.id,
    name: userData.name,
    email: userData.email,
  },
});

const mocks = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  authContext: null as {
    auth_type: "api_token" | "session";
    user_id: string;
    form_ids?: string[];
    share_link_id?: string;
  } | null,
  createInvitation: vi.fn(),
  deleteShareLink: vi.fn(),
  getUserFormPermission: vi.fn(),
  permissionRoles: new Map<string, MockPermissionRole>(),
  removePermission: vi.fn(),
  saveFormStructure: vi.fn(),
  shareLinkRoles: new Map<string, Exclude<MockPermissionRole, "OWNER">>(),
  shareTokenLinks: new Map<
    string,
    {
      formId: string;
      linkId: string;
      role: Exclude<MockPermissionRole, "OWNER">;
      state: "active" | "deleted" | "expired";
    }
  >(),
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
  formValidationRule: {},
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
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  count: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  lte: vi.fn(),
  ne: vi.fn(),
  or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
  sql: vi.fn(),
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
      const role = mocks.authContext.share_link_id
        ? mocks.shareLinkRoles.get(mocks.authContext.share_link_id)
        : mocks.permissionRoles.get(mocks.authContext.user_id);
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
  acceptInvitation: mocks.acceptInvitation,
  cancelInvitation: vi.fn(),
  createInvitation: mocks.createInvitation,
  createShareLink: vi.fn(),
  deleteShareLink: mocks.deleteShareLink,
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

vi.mock("../lib/forms/form-structure-service", () => ({
  getFormStructure: vi.fn(),
  getFormStructureDiff: vi.fn(),
  getFormStructureHistory: vi.fn(),
  restoreFormStructure: vi.fn(),
  saveFormStructure: mocks.saveFormStructure,
}));

vi.mock("../lib/forms/structure-mutation-lock", () => ({
  withFormStructureMutationLock: async (
    _formId: string,
    callback: () => Promise<unknown>,
  ) => callback(),
}));

vi.mock("../lib/resolve-audit-user-id", () => ({
  resolveAuditUserId: (userId: string) => userId,
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
  hashPassword: vi.fn(),
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
const { formsInvitesRouter } = await import("../routes/forms-invites");
const { formsPermissionsRouter } = await import("../routes/forms-permissions");
const { formsPublicRouter } = await import("../routes/forms-public");
const { formsResponsesRouter } = await import("../routes/forms-responses");
const { formsStructureRouter } = await import("../routes/forms-structure");

function createApp() {
  return createHonoApp()
    .route("/api/forms", formsPublicRouter)
    .route("/api/forms", formsInvitesRouter)
    .route("/api/forms", formsPermissionsRouter)
    .route("/api/forms", formsResponsesRouter)
    .route("/api/forms", formsStructureRouter);
}

function useSession(userId: string) {
  mocks.authContext = { auth_type: "session", user_id: userId };
}

function useShareLinkSession(
  linkId: string,
  role: Exclude<MockPermissionRole, "OWNER">,
) {
  mocks.shareLinkRoles.set(linkId, role);
  mocks.authContext = {
    auth_type: "api_token",
    user_id: `share-link:${linkId}`,
    form_ids: ["form-1"],
    share_link_id: linkId,
  };
}

function seedR25PermissionFixtures() {
  mocks.permissionRoles.clear();
  mocks.permissionRoles.set(r25Users.owner.id, r25Users.owner.role);
  mocks.permissionRoles.set(r25Users.editor.id, r25Users.editor.role);
  mocks.permissionRoles.set(r25Users.viewer.id, r25Users.viewer.role);
}

function seedShareToken(
  token: string,
  role: Exclude<MockPermissionRole, "OWNER">,
  state: "active" | "deleted" | "expired" = "active",
) {
  mocks.shareTokenLinks.set(token, {
    formId: "form-1",
    linkId: `${token}-link`,
    role,
    state,
  });
}

function sharedLinkResponse(
  link: NonNullable<ReturnType<typeof mocks.shareTokenLinks.get>>,
) {
  return {
    form: {
      id: link.formId,
      title: "Shared Form",
      description: "Shared description",
    },
    role: link.role,
    share_link: {
      id: link.linkId,
      form_id: link.formId,
      token: "redacted-in-route-response",
      role: link.role,
      is_active: true,
      expires_at: undefined,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
      created_by: r25Users.editor.id,
    },
  };
}

describe("R23-T3 share and permission routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession(r25Users.editor.id);
    seedR25PermissionFixtures();
    mocks.permissionRoles.set("target-user", "EDITOR");
    mocks.shareLinkRoles.clear();
    mocks.shareTokenLinks.clear();
    seedShareToken("viewer-token", "VIEWER");
    seedShareToken("editor-token", "EDITOR");
    mocks.createInvitation.mockResolvedValue(invitationResponse);
    mocks.acceptInvitation.mockResolvedValue(permissionResponse("VIEWER"));
    mocks.deleteShareLink.mockImplementation(async (linkId: string) => {
      for (const [token, link] of mocks.shareTokenLinks.entries()) {
        if (link.linkId === linkId) {
          mocks.shareTokenLinks.set(token, { ...link, state: "deleted" });
        }
      }
    });
    mocks.getUserFormPermission.mockResolvedValue("EDITOR");
    mocks.removePermission.mockResolvedValue(undefined);
    mocks.updatePermissionRole.mockImplementation(
      async (
        _formId: string,
        userId: string,
        role: Exclude<MockPermissionRole, "OWNER">,
      ) => {
        mocks.permissionRoles.set(userId, role);
        return permissionResponse(role);
      },
    );
    mocks.saveFormStructure.mockResolvedValue({
      id: "structure-version-1",
      formId: "form-1",
      version: 2,
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      changeLog: "R25 edit",
      parentVersion: 1,
    });
    mocks.validateShareLink.mockImplementation(async (token: string) => {
      const link = mocks.shareTokenLinks.get(token);
      if (!link || link.state === "deleted") {
        throw new Error("Share link not found");
      }
      if (link.state === "expired") {
        throw new Error("Share link has expired");
      }
      return sharedLinkResponse(link);
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

  it("uses the share-link role for a separate visitor instead of stored user permissions", async () => {
    const app = createApp();
    mocks.permissionRoles.set("target-user", "OWNER");
    mocks.shareLinkRoles.set("viewer-link", "VIEWER");
    // Defense-in-depth invariant: token authentication currently does not emit
    // both a real user_id and share_link_id, but /permissions/me must still
    // prefer the share-link role if such a context reaches the route.
    mocks.authContext = {
      auth_type: "api_token",
      user_id: "target-user",
      form_ids: ["form-1"],
      share_link_id: "viewer-link",
    };

    const response = await app.request("/api/forms/form-1/permissions/me");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ role: "VIEWER" });
  });

  it("blocks a separate visitor using a VIEWER share link from editor-only permission routes", async () => {
    const app = createApp();
    mocks.shareLinkRoles.set("viewer-link", "VIEWER");
    mocks.authContext = {
      auth_type: "api_token",
      user_id: "share-link:viewer-link",
      form_ids: ["form-1"],
      share_link_id: "viewer-link",
    };

    const response = await app.request("/api/forms/form-1/invitations", {
      body: JSON.stringify({
        email: "target@example.com",
        role: "VIEWER",
        message: "Please review",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INSUFFICIENT_PERMISSIONS",
        message: "Insufficient permissions",
      },
    });
    expect(mocks.createInvitation).not.toHaveBeenCalled();
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

  it("shows EDITOR before removal and rejects access after permission deletion", async () => {
    const app = createApp();
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

  describe("R25-M5 multi-user share and invitation regression", () => {
    it("keeps owner/editor/viewer/respondent fixtures in separate sessions", async () => {
      const app = createApp();

      useSession(r25Users.owner.id);
      const owner = await app.request("/api/forms/form-1/permissions/me");
      useSession(r25Users.editor.id);
      const editor = await app.request("/api/forms/form-1/permissions/me");
      useSession(r25Users.viewer.id);
      const viewer = await app.request("/api/forms/form-1/permissions/me");
      useSession(r25Users.respondent.id);
      const respondent = await app.request("/api/forms/form-1/permissions/me");

      expect(owner.status).toBe(200);
      await expect(owner.json()).resolves.toEqual({ role: "OWNER" });
      expect(editor.status).toBe(200);
      await expect(editor.json()).resolves.toEqual({ role: "EDITOR" });
      expect(viewer.status).toBe(200);
      await expect(viewer.json()).resolves.toEqual({ role: "VIEWER" });
      expect(respondent.status).toBe(403);
      await expect(respondent.json()).resolves.toMatchObject({
        error: {
          code: "INSUFFICIENT_PERMISSIONS",
          message: "Insufficient permissions",
        },
      });
    });

    it("blocks VIEWER sessions and VIEWER share links from editing and response management routes", async () => {
      const app = createApp();

      useSession(r25Users.viewer.id);
      const viewerStructureEdit = await app.request(
        "/api/forms/form-1/structure",
        {
          body: JSON.stringify({
            structure: { version: 1, settings: {} },
            changeLog: "viewer edit attempt",
          }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        },
      );
      const viewerResponses = await app.request("/api/forms/form-1/responses", {
        body: JSON.stringify({ responses: [] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });

      useShareLinkSession("viewer-link", "VIEWER");
      const shareLinkResponses = await app.request(
        "/api/forms/form-1/responses",
        {
          body: JSON.stringify({ responses: [] }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );

      for (const response of [
        viewerStructureEdit,
        viewerResponses,
        shareLinkResponses,
      ]) {
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Insufficient permissions",
          },
        });
      }
      expect(mocks.saveFormStructure).not.toHaveBeenCalled();
    });

    it("allows EDITOR editing and invitations while rejecting owner-only permission changes", async () => {
      const app = createApp();
      useSession(r25Users.editor.id);

      const structureEdit = await app.request("/api/forms/form-1/structure", {
        body: JSON.stringify({
          structure: { version: 1, settings: {} },
          changeLog: "R25 edit",
        }),
        headers: { "content-type": "application/json" },
        method: "PUT",
      });
      const invitation = await app.request("/api/forms/form-1/invitations", {
        body: JSON.stringify({
          email: r25Users.viewer.email,
          role: "VIEWER",
          message: "Please review",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const ownerOnlyMutation = await app.request(
        `/api/forms/form-1/permissions/${r25Users.viewer.id}`,
        {
          body: JSON.stringify({ role: "EDITOR" }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        },
      );

      expect(structureEdit.status).toBe(200);
      expect(mocks.saveFormStructure).toHaveBeenCalledWith(
        "form-1",
        { version: 1, settings: { allow_edit_responses: false } },
        r25Users.editor.id,
        "R25 edit",
      );
      expect(invitation.status).toBe(201);
      expect(mocks.createInvitation).toHaveBeenCalledWith(
        "form-1",
        r25Users.viewer.email,
        "VIEWER",
        r25Users.editor.id,
        "Please review",
        undefined,
      );
      expect(ownerOnlyMutation.status).toBe(403);
      expect(mocks.updatePermissionRole).not.toHaveBeenCalledWith(
        "form-1",
        r25Users.viewer.id,
        "EDITOR",
      );
    });

    it("accepts an invitation as a different user session and grants the invited VIEWER role", async () => {
      const app = createApp();
      const viewerPermission = permissionResponseForUser("VIEWER", {
        id: r25Users.viewer.id,
        name: "Viewer User",
        email: r25Users.viewer.email,
      });
      mocks.acceptInvitation.mockResolvedValueOnce(viewerPermission);
      useSession(r25Users.viewer.id);

      const response = await app.request(
        `/api/forms/invites/${validInviteToken}/accept`,
        { method: "POST" },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        permission: viewerPermission,
      });
      expect(mocks.acceptInvitation).toHaveBeenCalledWith(
        validInviteToken,
        r25Users.viewer.id,
      );
    });

    it("keeps expired and deleted public share-link re-access generic while deleting links by id", async () => {
      const app = createApp();
      seedShareToken("expired-token", "VIEWER", "expired");

      const activeBeforeDeletion = await app.request(
        "/api/forms/shared/viewer-token",
      );
      useSession(r25Users.owner.id);
      const deletion = await app.request(
        "/api/forms/form-1/share-links/viewer-token-link",
        {
          method: "DELETE",
        },
      );
      const deletedAfterDeletion = await app.request(
        "/api/forms/shared/viewer-token",
      );
      const expired = await app.request("/api/forms/shared/expired-token");

      expect(activeBeforeDeletion.status).toBe(200);
      expect(deletion.status).toBe(200);
      expect(deletedAfterDeletion.status).toBe(404);
      expect(expired.status).toBe(404);
      await expect(deletedAfterDeletion.json()).resolves.toEqual({
        error: "Share link not found",
      });
      await expect(expired.json()).resolves.toEqual({
        error: "Share link not found",
      });
      expect(mocks.deleteShareLink).toHaveBeenCalledWith(
        "viewer-token-link",
        "form-1",
      );
    });

    it("rejects response management after an EDITOR is downgraded to VIEWER", async () => {
      const app = createApp();

      useSession(r25Users.editor.id);
      const beforeDowngrade = await app.request(
        "/api/forms/form-1/permissions/me",
      );
      useSession(r25Users.owner.id);
      const downgrade = await app.request(
        `/api/forms/form-1/permissions/${r25Users.editor.id}`,
        {
          body: JSON.stringify({ role: "VIEWER" }),
          headers: { "content-type": "application/json" },
          method: "PUT",
        },
      );
      useSession(r25Users.editor.id);
      const afterDowngrade = await app.request(
        "/api/forms/form-1/permissions/me",
      );
      const responsesAfterDowngrade = await app.request(
        "/api/forms/form-1/responses",
        {
          body: JSON.stringify({ responses: [] }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );

      expect(beforeDowngrade.status).toBe(200);
      await expect(beforeDowngrade.json()).resolves.toEqual({
        role: "EDITOR",
      });
      expect(downgrade.status).toBe(200);
      expect(mocks.updatePermissionRole).toHaveBeenCalledWith(
        "form-1",
        r25Users.editor.id,
        "VIEWER",
      );
      expect(afterDowngrade.status).toBe(200);
      await expect(afterDowngrade.json()).resolves.toEqual({ role: "VIEWER" });
      expect(responsesAfterDowngrade.status).toBe(403);
    });
  });
});
