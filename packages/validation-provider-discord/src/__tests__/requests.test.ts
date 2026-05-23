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
  it("returns an exact match from the max-size search response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/members/search")) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: vi
              .fn()
              .mockResolvedValue([
                makeMember("111111111111111111", "otheruser"),
                makeMember("222222222222222222", "targetuser"),
              ]),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });
      }),
    );

    const member = await findGuildMemberByUsername(
      token,
      guildId,
      "targetuser",
    );

    expect(member?.user.username).toBe("targetuser");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("falls back to list members pagination when search is saturated", async () => {
    const targetId = "999999999999999999";
    const saturatedSearch = Array.from({ length: 1000 }, (_, index) =>
      makeMember(
        String(100000000000000000n + BigInt(index)),
        `targetuser_${index}`,
      ),
    );
    const listPage = Array.from({ length: 1000 }, (_, index) =>
      makeMember(
        String(200000000000000000n + BigInt(index)),
        `listed_${index}`,
      ),
    );
    const lastListId = listPage.at(-1)?.user.id ?? "";

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/members/search")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi.fn().mockResolvedValue(saturatedSearch),
        });
      }
      if (url.includes("/members?")) {
        const isSecondListPage = url.includes(`after=${lastListId}`);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: vi
            .fn()
            .mockResolvedValue(
              isSecondListPage
                ? [makeMember(targetId, "targetuser")]
                : listPage,
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
    const listCalls = fetchMock.mock.calls.filter(([calledUrl]) =>
      String(calledUrl).includes("/members?"),
    );
    expect(searchCalls).toHaveLength(1);
    expect(String(searchCalls[0]?.[0])).toContain("limit=1000");
    expect(listCalls).toHaveLength(2);
    expect(String(listCalls[1]?.[0])).toContain(`after=${lastListId}`);
  });

  it("returns undefined when search and list scans find no exact match", async () => {
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
