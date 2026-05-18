import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  eq: vi.fn((left, right) => ({ op: "eq", left, right })),
  hashToken: vi.fn(),
  computeLookupHash: vi.fn(),
  generateSecureToken: vi.fn(),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
  },
  user: {},
  session: {},
  account: {},
  verificationToken: {},
  form: {},
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {
    id: "apiToken.id",
    lookupHash: "apiToken.lookupHash",
  },
  formShareLink: {
    id: "formShareLink.id",
    token: "formShareLink.token",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
}));

vi.mock("../lib/tokens/generate", () => ({
  generateSecureToken: mocks.generateSecureToken,
}));

vi.mock("../lib/tokens/hash", () => ({
  hashToken: mocks.hashToken,
  computeLookupHash: mocks.computeLookupHash,
}));

function mockSelectResults(resultSets: unknown[][]): void {
  let callIndex = 0;
  mocks.select.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockImplementation(() => {
          const result = resultSets[callIndex] ?? [];
          callIndex += 1;
          return Promise.resolve(result);
        }),
      }),
    }),
  }));
}

describe("createApiTokenForShareLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateSecureToken.mockReturnValue("ct_share_plain_token");
    mocks.hashToken.mockResolvedValue("bcrypt-share-token");
    mocks.computeLookupHash.mockReturnValue("sha256-share-token");
    mocks.insertValues.mockResolvedValue(undefined);
    mocks.insert.mockReturnValue({ values: mocks.insertValues });
  });

  it("stores lookupHash so the issued share-link token can be validated by O(1) lookup", async () => {
    const createdAt = new Date("2999-05-17T00:00:00.000Z");
    const updatedAt = new Date("2999-05-17T00:00:01.000Z");
    const expiresAt = new Date("2999-05-18T00:00:00.000Z");
    mockSelectResults([
      [
        {
          id: "share-link-id",
          formId: "form-id",
          token: "share-token",
          role: "VIEWER",
          isActive: true,
          expiresAt,
          createdAt,
          updatedAt,
          createdBy: "owner-id",
        },
      ],
      [
        {
          id: "api-token-id",
          userId: null,
          name: "Share Link: Untitled",
          tokenHash: "bcrypt-share-token",
          scopes: ["read"],
          formIds: ["form-id"],
          type: "SHARE_LINK",
          isActive: true,
          expiresAt,
          lastUsedAt: null,
          revokedAt: null,
          createdAt,
          updatedAt,
          shareLinkId: "share-link-id",
        },
      ],
      [
        {
          id: "share-link-id",
          formId: "form-id",
          token: "share-token",
          role: "VIEWER",
          isActive: true,
          expiresAt,
          createdAt,
          updatedAt,
          createdBy: "owner-id",
        },
      ],
    ]);

    const { createApiTokenForShareLink } = await import(
      "../lib/tokens/share-link-token"
    );

    await expect(
      createApiTokenForShareLink("share-token", "form-id"),
    ).resolves.toMatchObject({
      token: "ct_share_plain_token",
      apiToken: {
        tokenHash: "bcrypt-share-token",
        scopes: ["read"],
        formIds: ["form-id"],
        shareLinkId: "share-link-id",
      },
    });

    expect(mocks.hashToken).toHaveBeenCalledWith("ct_share_plain_token");
    expect(mocks.computeLookupHash).toHaveBeenCalledWith(
      "ct_share_plain_token",
    );
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenHash: "bcrypt-share-token",
        lookupHash: "sha256-share-token",
        type: "SHARE_LINK",
        shareLinkId: "share-link-id",
      }),
    );
  });
});
