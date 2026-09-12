import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { fetchQuote, cache } = vi.hoisted(() => ({
  fetchQuote: vi.fn(),
  cache: { findUnique: vi.fn(), upsert: vi.fn() },
}));
vi.mock("@/lib/env", () => ({
  env: {
    ALPACA_API_KEY: "synthetic-key",
    ALPACA_API_SECRET: "synthetic-secret",
    ALPACA_FEED: "iex",
    ALPACA_DATA_BASE_URL: "http://127.0.0.1:1",
    ALPACA_REFERENCE_BASE_URL: "http://127.0.0.1:1",
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { quoteCache: cache } }));
vi.mock("@/server/providers/factory", async () => {
  const { AlpacaEquityProvider } = await import("@/server/providers/alpaca");
  return {
    providers: { equities: new AlpacaEquityProvider(), options: {} },
    quoteSourceFor: () => "alpaca-iex",
  };
});
let service: typeof import("@/server/services/quote-service");
const payload = (symbol = "PL") => ({
  quotes: { [symbol]: { bp: 32, ap: 32.05, t: "2026-09-09T20:00:00Z" } },
});
const response = (data: unknown) => ({ ok: true, json: async () => data });
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T04:30:00Z"));
  vi.resetModules();
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", fetchQuote);
  cache.findUnique.mockResolvedValue(null);
  fetchQuote.mockResolvedValue(response(payload()));
  service = await import("@/server/services/quote-service");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("forced equity quote refresh", () => {
  it("bypasses a still-valid provider cache and blocks when the next upstream request fails", async () => {
    expect((await service.getQuoteResult("PL", "EQUITY")).quote?.ask).toBe(
      32.05,
    );
    expect(fetchQuote).toHaveBeenCalledTimes(1);
    fetchQuote.mockRejectedValueOnce(
      new TypeError("Synthetic upstream failure"),
    );
    const forced = await service.getQuoteResult("PL", "EQUITY", true);
    expect(fetchQuote).toHaveBeenCalledTimes(2);
    expect(forced).toEqual({ quote: null, refreshFailed: true });
    expect(cache.upsert).toHaveBeenCalledTimes(1);
  });

  it("still deduplicates simultaneous requests while waiting for an actual upstream response", async () => {
    let finish!: (value: unknown) => void;
    fetchQuote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const requests = [
      service.getQuoteResult("PL", "EQUITY", true),
      service.getQuoteResult("PL", "EQUITY", true),
    ];
    await vi.waitFor(() => expect(fetchQuote).toHaveBeenCalledTimes(1));
    finish(response(payload()));
    const values = await Promise.all(requests);
    expect(
      values.every(
        (value) => value.quote?.symbol === "PL" && !value.refreshFailed,
      ),
    ).toBe(true);
    expect(fetchQuote).toHaveBeenCalledTimes(1);
  });

  it("rejects a different raw symbol before normalization or storage", async () => {
    fetchQuote.mockResolvedValue(response(payload("TSLA")));
    expect(await service.getQuoteResult("PL", "EQUITY", true)).toEqual({
      quote: null,
      refreshFailed: true,
    });
    expect(cache.upsert).not.toHaveBeenCalled();
  });

  it("rejects an asset-class mismatch from the equity adapter", async () => {
    const { providers } = await import("@/server/providers/factory");
    vi.spyOn(providers.equities, "getQuote").mockResolvedValue({
      symbol: "PL",
      assetClass: "OPTION",
      source: "alpaca-iex",
      bid: 32,
      ask: 32.05,
      mark: 32.025,
      last: null,
      asOf: new Date(),
    });
    expect(await service.getQuoteResult("PL", "EQUITY", true)).toEqual({
      quote: null,
      refreshFailed: true,
    });
    expect(cache.upsert).not.toHaveBeenCalled();
  });
});
