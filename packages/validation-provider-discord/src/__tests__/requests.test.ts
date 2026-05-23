import { afterEach, describe, expect, it, vi } from "vitest";
import { findGuildMemberByUsername } from "../requests";
import { ZDiscordGuildId, ZDiscordToken } from "../types";

const guildId = ZDiscordGuildId.parse("123456789012345678");
const token = ZDiscordToken.parse("bot-token");

const makeMember = (id: string, username: string) => ({
  user: { id, username },
  roles: [] as string[],
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("findGuildMemberByUsername", () => {
  it("paginates member search when the target is beyond the first page", async () => {
    const targetId = "999999999999999999";
    const pageSize = 100;
    const firstPage = Array.from({ length: pageSize }, (_, index) =>
      makeMember(
        String(100000000000000000n + BigInt(index)),
        `targetuser_${index}`,
      ),
    );
    const lastFirstPageId = firstPage.at(-1)?.user.id ?? "";

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/members/search")) {
        const isSecondPage = url.includes(`after=${lastFirstPageId}`);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi
            .fn()
            .mockResolvedValue(
              isSecondPage ? [makeMember(targetId, "targetuser")] : firstPage,
            ),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const member = await findGuildMemberByUsername(
      token,
      guildId,
      "targetuser",
    );

    expect(member?.user.username).toBe("targetuser");
    expect(member?.user.id).toBe(targetId);
    const searchCalls = fetchMock.mock.calls.filter(([calledUrl]) =>
      String(calledUrl).includes("/members/search"),
    );
    expect(searchCalls).toHaveLength(2);
    expect(String(searchCalls[0]?.[0])).toContain("limit=100");
    expect(String(searchCalls[1]?.[0])).toContain(`after=${lastFirstPageId}`);
  });

  it("returns undefined when no page contains an exact username match", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi
          .fn()
          .mockResolvedValue([makeMember("111111111111111111", "otheruser")]),
      }),
    );

    const member = await findGuildMemberByUsername(
      token,
      guildId,
      "targetuser",
    );

    expect(member).toBeUndefined();
  });
});
