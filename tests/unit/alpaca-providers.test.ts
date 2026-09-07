import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/env", () => ({
  env: {
    MARKET_DATA_MODE: "live",
    ALPACA_FEED: "sip",
    OPTIONS_PROVIDER: "alpaca",
    ALPACA_API_KEY: "test-key",
    ALPACA_API_SECRET: "test-secret",
    ALPACA_DATA_BASE_URL: "https://data.alpaca.markets",
    ALPACA_REFERENCE_BASE_URL: "https://paper-api.alpaca.markets",
  },
}));
vi.mock("@/server/providers/request", () => ({ providerRequest: vi.fn() }));
import { providerRequest } from "@/server/providers/request";
import {
  AlpacaOptionsProvider,
  parseAlpacaOption,
} from "@/server/providers/alpaca-options";
import {
  AlpacaEquityProvider,
  parseAlpacaEquityQuote,
} from "@/server/providers/alpaca";
import { loadAlpacaSymbols } from "@/server/providers/alpaca-symbols";
import { quoteSourceFor } from "@/server/providers/factory";
const request = vi.mocked(providerRequest);
const meta = {
  symbol: "BTG280121C00005000",
  underlying_symbol: "BTG",
  root_symbol: "BTG",
  type: "call" as const,
  strike_price: "5",
  expiration_date: "2028-01-21",
  size: "100",
  status: "active",
};
const snapshot = {
  latestQuote: { bp: 1.8, ap: 1.84, t: "2026-09-04T19:58:00Z" },
  latestTrade: { p: 1.83, t: "2026-09-04T20:00:00Z" },
  impliedVolatility: 0.65,
};
beforeEach(() => request.mockReset());
describe("Alpaca consolidated data adapters", () => {
  it("preserves NBBO timestamp independently of last trade", () => {
    const q = parseAlpacaOption(meta, snapshot);
    expect(q.mark).toBeCloseTo(1.82);
    expect(q.last).toBe(1.83);
    expect(q.asOf?.toISOString()).toBe("2026-09-04T19:58:00.000Z");
    expect(q.source).toBe("alpaca-opra");
    expect(q.multiplier).toBe(100);
  });
  it("never fabricates a fresh quote timestamp or bid/ask from a trade", () => {
    const q = parseAlpacaOption(meta, { latestTrade: { p: 1.83 } });
    expect(q.bid).toBeNull();
    expect(q.ask).toBeNull();
    expect(q.asOf?.getTime()).toBe(0);
    expect(
      parseAlpacaEquityQuote("BTG", { bp: 5, t: "invalid" }).asOf.getTime(),
    ).toBe(0);
  });
  it("rejects invalid prices and avoids a false midpoint for one-sided markets", () => {
    expect(
      parseAlpacaOption(meta, { latestQuote: { bp: 0, ap: 2 } }).mark,
    ).toBeNull();
    const q = parseAlpacaOption(meta, { latestQuote: { bp: NaN, ap: -5 } });
    expect(q.bid).toBeNull();
    expect(q.ask).toBeNull();
  });
  it("requires explicit OPRA and does not retry indicative after a 403", async () => {
    request
      .mockResolvedValueOnce(meta)
      .mockRejectedValueOnce(
        new Error("Alpaca: credentials/entitlement (403)"),
      );
    await expect(
      new AlpacaOptionsProvider().getOptionQuote(meta.symbol),
    ).rejects.toThrow(/403/);
    expect(request).toHaveBeenCalledTimes(2);
    expect(new URL(request.mock.calls[1][1]).searchParams.get("feed")).toBe(
      "opra",
    );
  });
  it("rejects adjusted contract multipliers", async () => {
    request.mockResolvedValueOnce({ ...meta, size: "10" });
    expect(
      await new AlpacaOptionsProvider().getOptionQuote(meta.symbol),
    ).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("loads every expiration page, including long-dated contracts", async () => {
    request.mockResolvedValueOnce({
      option_contracts: [{ ...meta, expiration_date: "2026-10-16" }],
      next_page_token: "next",
    });
    request.mockResolvedValueOnce({
      option_contracts: [meta],
      next_page_token: null,
    });
    expect(await new AlpacaOptionsProvider().getExpirations("BTG")).toEqual([
      "2026-10-16",
      "2028-01-21",
    ]);
    expect(
      new URL(request.mock.calls[0][1]).searchParams.get("expiration_date_lte"),
    ).toBe("2100-01-01");
    expect(
      new URL(request.mock.calls[1][1]).searchParams.get("page_token"),
    ).toBe("next");
  });
  it("fails visibly on repeated pagination tokens rather than looping forever", async () => {
    request.mockResolvedValue({
      option_contracts: [meta],
      next_page_token: "loop",
    });
    await expect(
      new AlpacaOptionsProvider().getExpirations("BTG"),
    ).rejects.toThrow(/pagination/);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("paginates snapshots and retains listed contracts without quotes as unavailable", async () => {
    const second = { ...meta, symbol: "BTG280121C00006000", strike_price: "6" };
    request.mockResolvedValueOnce({ option_contracts: [meta, second] });
    request.mockResolvedValueOnce({ snapshots: {}, next_page_token: "next" });
    request.mockResolvedValueOnce({ snapshots: { [meta.symbol]: snapshot } });
    const chain = await new AlpacaOptionsProvider().getOptionChain(
      "BTG",
      "2028-01-21",
    );
    expect(chain).toHaveLength(2);
    expect(chain[0].ask).toBe(1.84);
    expect(chain[1].ask).toBeNull();
    expect(chain[1].asOf?.getTime()).toBe(0);
    expect(
      new URL(request.mock.calls[2][1]).searchParams.get("page_token"),
    ).toBe("next");
  });
  it("requests consolidated SIP without treating the ask as a last trade", async () => {
    request.mockResolvedValueOnce({
      quotes: { TSLA: { bp: 320, ap: 321, t: "2026-09-04T19:58:00Z" } },
    });
    const q = await new AlpacaEquityProvider().getQuote("TSLA");
    expect(q?.last).toBeNull();
    expect(q?.source).toBe("alpaca-sip");
    expect(new URL(request.mock.calls[0][1]).searchParams.get("feed")).toBe(
      "sip",
    );
  });
  it("includes listed ETFs and filters out OTC and inactive assets", async () => {
    request.mockResolvedValueOnce([
      {
        symbol: "SPY",
        name: "SPDR S&P 500 ETF",
        exchange: "ARCA",
        status: "active",
        class: "us_equity",
        tradable: false,
      },
      { symbol: "OTCX", exchange: "OTC", status: "active", class: "us_equity" },
      {
        symbol: "OLD",
        exchange: "NYSE",
        status: "inactive",
        class: "us_equity",
      },
    ]);
    expect((await loadAlpacaSymbols()).map((a) => a.symbol)).toEqual(["SPY"]);
  });
  it("names cache sources by actual feed, not only vendor", () => {
    expect(quoteSourceFor("EQUITY")).toBe("alpaca-sip");
    expect(quoteSourceFor("OPTION")).toBe("alpaca-opra");
  });
});
