import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let request: typeof import("@/server/providers/request").providerRequest;
const fetchMock = vi.fn();
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  request = (await import("@/server/providers/request")).providerRequest;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("QA: bounded provider request failures and cache behavior (no network)", () => {
  it("coalesces 16 simultaneous requests into one fetch", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ price: 10 })));
    const results = await Promise.all(
      Array.from({ length: 16 }, () =>
        request("QA", "https://qa.invalid/quote"),
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual(Array(16).fill({ price: 10 }));
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
  it("expires successful cache entries at the requested TTL", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ price: fetchMock.mock.calls.length })),
    );
    expect(await request("QA", "https://qa.invalid/quote", {}, 1000)).toEqual({
      price: 1,
    });
    vi.advanceTimersByTime(999);
    expect(await request("QA", "https://qa.invalid/quote", {}, 1000)).toEqual({
      price: 1,
    });
    vi.advanceTimersByTime(1);
    expect(await request("QA", "https://qa.invalid/quote", {}, 1000)).toEqual({
      price: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 500])(
    "propagates HTTP %s and permits a later retry",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        new Response("upstream failed", { status }),
      );
      await expect(request("QA", "https://qa.invalid/quote")).rejects.toThrow(
        String(status),
      );
      fetchMock.mockResolvedValueOnce(new Response("{}"));
      await expect(request("QA", "https://qa.invalid/quote")).resolves.toEqual(
        {},
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
  it.each([429, 503])(
    "honors bounded Retry-After cooldown on HTTP %s",
    async (status) => {
      fetchMock.mockResolvedValueOnce(
        new Response("limited", { status, headers: { "Retry-After": "9999" } }),
      );
      await expect(request("QA", "https://qa.invalid/one")).rejects.toThrow(
        String(status),
      );
      await expect(request("QA", "https://qa.invalid/two")).rejects.toThrow(
        /rate-limited/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(120000);
      fetchMock.mockResolvedValueOnce(new Response("{}"));
      await expect(request("QA", "https://qa.invalid/one")).resolves.toEqual(
        {},
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
  it("clears all coalesced failures instead of poisoning future requests", async () => {
    fetchMock.mockRejectedValueOnce(new Error("simulated connection reset"));
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        request("QA", "https://qa.invalid/quote"),
      ),
    );
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await expect(request("QA", "https://qa.invalid/quote")).resolves.toEqual(
      {},
    );
  });
  it("does not cache malformed successful response bodies", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not JSON"));
    await expect(
      request("QA", "https://qa.invalid/quote", {}, 60000),
    ).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(new Response("{}"));
    await expect(
      request("QA", "https://qa.invalid/quote", {}, 60000),
    ).resolves.toEqual({});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
