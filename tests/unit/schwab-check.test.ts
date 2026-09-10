import { beforeEach, describe, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({
  state: "connected",
  env: {
    MARKET_DATA_MODE: "demo",
    EQUITY_PROVIDER: "schwab",
    OPTIONS_PROVIDER: "schwab",
    ALPACA_FEED: "iex",
    QUOTE_STALE_SECONDS: 120,
    TRADIER_API_TOKEN: "",
    TRADIER_BASE_URL: "https://api.tradier.com/v1",
  },
  equities: vi.fn(),
  dates: vi.fn(),
  chain: vi.fn(),
  option: vi.fn(),
  alpaca: vi.fn(),
  symbols: vi.fn(),
  tradier: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: fixtures.env }));
vi.mock("@/server/providers/schwab-client", () => ({
  schwabStatus: () => ({
    state: fixtures.state,
    detail: "Local state only; quote access unverified.",
  }),
}));
vi.mock("@/server/providers/schwab", () => ({
  SchwabEquityProvider: class {
    getQuotes = fixtures.equities;
  },
  SchwabOptionsProvider: class {
    getExpirations = fixtures.dates;
    getOptionChain = fixtures.chain;
    getOptionQuote = fixtures.option;
  },
}));
vi.mock("@/server/providers/alpaca-client", () => ({
  alpacaConfigured: () => true,
  alpacaGet: fixtures.alpaca,
  quoteTime: (time: unknown) => new Date(typeof time === "string" ? time : 0),
}));
vi.mock("@/server/providers/alpaca-symbols", () => ({
  loadAlpacaSymbols: fixtures.symbols,
}));
vi.mock("@/server/providers/tradier", () => ({
  TradierOptionsProvider: class {
    getExpirations = fixtures.tradier;
  },
}));
import { GET } from "@/app/api/market-data/check/route";
import { schwabQuoteCheck } from "@/server/services/schwab-check";
const quote = () => ({
  source: "schwab-equity",
  asOf: new Date(),
  bid: 100,
  ask: 101,
});
beforeEach(() => {
  vi.clearAllMocks();
  fixtures.state = "connected";
  fixtures.env.EQUITY_PROVIDER = "schwab";
  fixtures.env.OPTIONS_PROVIDER = "schwab";
  fixtures.equities.mockResolvedValue(
    ["AAPL", "SPY"].map((symbol) => ({ ...quote(), symbol })),
  );
  fixtures.dates.mockResolvedValue(["2030-06-21"]);
  fixtures.chain.mockResolvedValue([
    { ...quote(), contractSymbol: "SPY300621C00500000" },
  ]);
  fixtures.option.mockResolvedValue({ ...quote(), source: "schwab-option" });
  fixtures.alpaca.mockResolvedValue({
    quotes: { SPY: { t: new Date().toISOString() } },
    snapshots: { option: { latestQuote: { t: new Date().toISOString() } } },
  });
  fixtures.symbols.mockResolvedValue([{ symbol: "SPY" }]);
});

describe("provider-aware connection diagnostics", () => {
  it("probes selected Schwab feeds even in demo and separates authorization from stock/ETF/option access", async () => {
    const response = await GET(),
      result = await response.json();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(result.mode).toBe("demo");
    expect(result.equityFeedConfigured).toBe("schwab");
    expect(result.checks.map((c: { status: string }) => c.status)).toEqual([
      "connected",
      "accessible_fresh",
      "accessible_fresh",
      "accessible_fresh",
    ]);
    expect(fixtures.equities).toHaveBeenCalledWith(["AAPL", "SPY"]);
    expect(fixtures.option).toHaveBeenCalledWith("SPY300621C00500000");
    expect(fixtures.alpaca).not.toHaveBeenCalled();
    expect(fixtures.symbols).not.toHaveBeenCalled();
    expect(fixtures.tradier).not.toHaveBeenCalled();
  });
  it.each([
    "not_configured",
    "not_connected",
    "reconnect_required",
    "invalid_storage",
  ])("does not request market data for local state %s", async (state) => {
    fixtures.state = state;
    const result = await (await GET()).json();
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].status).toBe(state);
    expect(fixtures.equities).not.toHaveBeenCalled();
    expect(fixtures.dates).not.toHaveBeenCalled();
  });
  it("reports refresh-due local authorization separately and preserves request failures", async () => {
    fixtures.state = "refresh_due";
    fixtures.equities.mockRejectedValueOnce(
      new Error("Schwab: market-data entitlement denied (403)."),
    );
    fixtures.option.mockResolvedValueOnce(null);
    const result = await (await GET()).json();
    expect(result.checks.map((c: { status: string }) => c.status)).toEqual([
      "refresh_due",
      "failed",
      "authorized_no_quote",
    ]);
  });
  it("retains selected Alpaca diagnostics and avoids Schwab calls", async () => {
    fixtures.env.EQUITY_PROVIDER = "alpaca";
    fixtures.env.OPTIONS_PROVIDER = "alpaca";
    const result = await (await GET()).json();
    expect(result.equityFeedConfigured).toBe("iex");
    expect(fixtures.symbols).toHaveBeenCalledOnce();
    expect(fixtures.alpaca).toHaveBeenCalledTimes(2);
    expect(fixtures.equities).not.toHaveBeenCalled();
    expect(fixtures.option).not.toHaveBeenCalled();
  });
  it("keeps missing Tradier setup separate in mixed configurations", async () => {
    fixtures.env.OPTIONS_PROVIDER = "tradier";
    const result = await (await GET()).json();
    expect(result.checks.at(-1)).toMatchObject({
      name: "Tradier option quotes",
      status: "not_configured",
    });
    expect(fixtures.option).not.toHaveBeenCalled();
  });
  it.each([
    [null, "authorized_no_quote"],
    [{ source: "schwab-equity-delayed" }, "accessible_delayed"],
    [{ source: "schwab-equity-indicative" }, "realtime_unconfirmed"],
    [{ asOf: new Date(0) }, "authorized_no_timestamp"],
    [{ asOf: new Date(Date.now() - 999999) }, "accessible_stale"],
    [{ asOf: new Date(Date.now() + 60000) }, "accessible_stale"],
    [{ bid: 0 }, "accessible_no_bid_ask"],
    [{ ask: 99 }, "accessible_no_bid_ask"],
    [{}, "accessible_fresh"],
  ])("classifies quote evidence %j as %s", (extra, expected) => {
    expect(
      schwabQuoteCheck("test", extra == null ? null : { ...quote(), ...extra })
        .status,
    ).toBe(expected);
  });
});
