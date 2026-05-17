import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../load-env", () => ({}));

const verifyToken = vi.fn();
const updateWhere = vi.fn();
const updateSet = vi.fn(() => ({ where: updateWhere }));
const update = vi.fn(() => ({ set: updateSet }));
const select = vi.fn();

vi.mock("@nexus-form/database", () => ({
  db: {
    select,
    update,
  },
  user: {
    id: "user.id",
    isSuspended: "user.isSuspended",
  },
}));

vi.mock("@nexus-form/database/schema", () => ({
  apiToken: {
    id: "apiToken.id",
    tokenHash: "apiToken.tokenHash",
    userId: "apiToken.userId",
    scopes: "apiToken.scopes",
    formIds: "apiToken.formIds",
    type: "apiToken.type",
    shareLinkId: "apiToken.shareLinkId",
    lookupHash: "apiToken.lookupHash",
    isActive: "apiToken.isActive",
    revokedAt: "apiToken.revokedAt",
    expiresAt: "apiToken.expiresAt",
  },
  formShareLink: {
    id: "formShareLink.id",
    isActive: "formShareLink.isActive",
    expiresAt: "formShareLink.expiresAt",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  isNull: vi.fn(),
  or: vi.fn(),
}));

vi.mock("../lib/tokens/hash", () => ({
  computeLookupHash: vi.fn(() => "lookup-hash"),
  verifyToken,
}));

const { validateApiToken } = await import("../lib/tokens/validate");

function mockSelectResults(resultSets: unknown[][]): void {
  let callIndex = 0;
  select.mockImplementation(() => ({
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

describe("validateApiToken owner suspension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateWhere.mockResolvedValue(undefined);
  });

  it("rejects tokens owned by suspended users without updating lastUsedAt", async () => {
    verifyToken.mockResolvedValueOnce(true);
    mockSelectResults([
      [
        {
          id: "token-id",
          tokenHash: "hashed-token",
          userId: "suspended-user",
          scopes: ["read"],
          formIds: null,
          type: "USER",
          shareLinkId: null,
        },
      ],
      [{ isSuspended: true }],
    ]);

    await expect(validateApiToken("ct_token")).resolves.toBeNull();
    expect(verifyToken).toHaveBeenCalledWith("ct_token", "hashed-token");
    expect(update).not.toHaveBeenCalled();
  });

  it("accepts tokens owned by active users", async () => {
    verifyToken.mockResolvedValueOnce(true);
    mockSelectResults([
      [
        {
          id: "token-id",
          tokenHash: "hashed-token",
          userId: "active-user",
          scopes: ["read"],
          formIds: null,
          type: "USER",
          shareLinkId: null,
        },
      ],
      [{ isSuspended: false }],
    ]);

    await expect(validateApiToken("ct_token")).resolves.toMatchObject({
      user_id: "active-user",
      token_id: "token-id",
      scopes: ["read"],
    });
    expect(update).toHaveBeenCalled();
  });
});
