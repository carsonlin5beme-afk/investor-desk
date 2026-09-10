import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({
  accessToken: vi.fn(),
  rejectAccessToken: vi.fn(),
  configured: vi.fn(() => true),
  status: vi.fn(() => ({ state: "connected" })),
}));
vi.mock("@/server/providers/schwab-auth.mjs", () => ({
  schwabAuth: () => auth,
}));
const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  auth.accessToken.mockResolvedValue("synthetic-access");
  auth.rejectAccessToken.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Schwab read-only transport", () => {
  it.each([
    "/accounts",
    "/orders",
    "/quotes?symbols=AAPL",
    "/../accounts",
    "https://evil.example/quotes",
    "//evil.example",
    "/quotes/",
  ])("rejects unsupported endpoint %s before auth", async (path) => {
    const { schwabGet } = await import("@/server/providers/schwab-client");
    await expect(schwabGet(path)).rejects.toThrow("unsupported market-data");
    expect(auth.accessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("coalesces simultaneous requests, uses fixed-origin GET without redirects, and fetches again next time", async () => {
    fetchMock.mockImplementation(async () => Response.json({ result: true }));
    const { schwabGet } = await import("@/server/providers/schwab-client");
    expect(
      await Promise.all(
        Array.from({ length: 12 }, () =>
          schwabGet("/quotes", { symbols: "SPY" }),
        ),
      ),
    ).toHaveLength(12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.schwabapi.com/marketdata/v1/quotes?symbols=SPY",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: { Authorization: "Bearer synthetic-access" },
    });
    await schwabGet("/quotes", { symbols: "SPY" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("refreshes once after401 and uses the rotated token", async () => {
    auth.accessToken.mockResolvedValueOnce("old").mockResolvedValueOnce("new");
    fetchMock
      .mockResolvedValueOnce(new Response("private", { status: 401 }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    const { schwabGet } = await import("@/server/providers/schwab-client");
    await expect(schwabGet("/quotes")).resolves.toEqual({ ok: true });
    expect(auth.accessToken).toHaveBeenNthCalledWith(2, "old");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer new");
  });
  it("bounds repeated401 and marks the rejected token instead of looping", async () => {
    fetchMock.mockImplementation(
      async () => new Response("private-body", { status: 401 }),
    );
    const { schwabGet } = await import("@/server/providers/schwab-client");
    await expect(schwabGet("/quotes")).rejects.toThrow("authorization expired");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.rejectAccessToken).toHaveBeenCalledWith("synthetic-access");
  });
  it.each([403, 429, 503, 500])(
    "sanitizes status%s and cools down429/503",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        new Response("private-body", {
          status,
          headers: { "retry-after": "1" },
        }),
      );
      const { schwabGet } = await import("@/server/providers/schwab-client");
      await expect(schwabGet("/quotes")).rejects.toThrow(`(${status})`);
      if ([429, 503].includes(status)) {
        await expect(schwabGet("/chains")).rejects.toThrow("rate-limited");
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
      expect(auth.rejectAccessToken).not.toHaveBeenCalled();
    },
  );
  it("sanitizes timeout/redirect failures, malformed and oversized payloads", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("private token in upstream URL"))
      .mockResolvedValueOnce(new Response("not json private"))
      .mockResolvedValueOnce(
        new Response("{}", { headers: { "content-length": "99999999" } }),
      );
    const { schwabGet } = await import("@/server/providers/schwab-client");
    await expect(schwabGet("/quotes")).rejects.toThrow(
      "request failed or timed out",
    );
    await expect(schwabGet("/quotes")).rejects.toThrow(
      "invalid market-data response",
    );
    await expect(schwabGet("/quotes")).rejects.toThrow(
      "invalid market-data response",
    );
  });
});
