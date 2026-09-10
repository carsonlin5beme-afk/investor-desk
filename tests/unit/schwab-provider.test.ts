import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/providers/schwab-client", () => ({ schwabGet: vi.fn() }));
import { schwabGet } from "@/server/providers/schwab-client";
import {
  canonicalSchwabOption,
  parseSchwabChainContract,
  parseSchwabEquity,
  SchwabEquityProvider,
  SchwabOptionsProvider,
  schwabTime,
} from "@/server/providers/schwab";
import { isQuoteStale } from "@/server/domain/staleness";
import { acceptsQuoteSource } from "@/server/providers/quote-sources";
const now = Date.parse("2029-06-01T14:00:00Z"),
  date = "2030-06-21",
  symbol = "SPY300621C00500000";
const row = (extra = {}) => ({
  symbol: "SPY   300621C00500000",
  putCall: "CALL",
  strikePrice: 500,
  multiplier: 100,
  isNonStandard: false,
  isMini: false,
  isIndexOption: false,
  optionRoot: "SPY",
  optionDeliverablesList: null,
  expirationDate: date + "T20:00:00Z",
  quoteTimeInLong: now,
  bidPrice: 12,
  askPrice: 13,
  lastPrice: 12.5,
  volatility: 32.89,
  ...extra,
});
const chain = (extra = {}) => ({
  symbol: "SPY",
  status: "SUCCESS",
  isIndex: false,
  isDelayed: false,
  underlying: { symbol: "SPY" },
  callExpDateMap: { [date + ":385"]: { "500.0": [row()] } },
  putExpDateMap: {},
  ...extra,
});
const reference = (extra = {}) => ({
  underlying: "SPY",
  contractType: "C",
  expirationDay: 21,
  expirationMonth: 6,
  expirationYear: 2030,
  multiplier: 100,
  strikePrice: 500,
  ...extra,
});
const quote = (extra = {}) => ({
  assetMainType: "OPTION",
  symbol: "SPY   300621C00500000",
  realtime: true,
  reference: reference(),
  quote: {
    bidPrice: 14,
    askPrice: 15,
    lastPrice: 14.5,
    quoteTime: now + 100,
    volatility: 0.0094,
  },
  ...extra,
});
beforeEach(() => {
  vi.mocked(schwabGet).mockReset();
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterEach(() => vi.restoreAllMocks());

describe("Schwab documented quote and option contracts", () => {
  it("normalizes padded calls, puts and compact LEAPS; rejects impossible dates and adjusted roots", () => {
    expect(canonicalSchwabOption("SPY   300621P00500000")).toMatchObject({
      symbol: "SPY300621P00500000",
      right: "PUT",
      strike: 500,
      date,
    });
    expect(canonicalSchwabOption(symbol)?.padded).toBe("SPY   300621C00500000");
    for (const invalid of [
      "SPY300231C00500000",
      "SPY1  300621C00500000",
      "SPY301321C00500000",
      "SPY300621X00500000",
      "SPY300621C0050000",
      "spy300621C00500000",
    ])
      expect(canonicalSchwabOption(invalid)).toBeNull();
  });
  it("matches equity identity/type, preserves quoteTime (never tradeTime), and does not invent real-time status", () => {
    const raw = {
      symbol: "SPY",
      assetMainType: "EQUITY",
      realtime: true,
      quote: {
        bidPrice: 499,
        askPrice: 501,
        lastPrice: 500,
        quoteTime: now - 1000,
        tradeTime: now,
      },
    };
    expect(parseSchwabEquity("SPY", raw)).toMatchObject({
      bid: 499,
      ask: 501,
      mark: 500,
      source: "schwab-equity",
      asOf: new Date(now - 1000),
    });
    expect(parseSchwabEquity("AAPL", raw)).toBeNull();
    expect(
      parseSchwabEquity("SPY", { ...raw, assetMainType: "INDEX" }),
    ).toBeNull();
    expect(parseSchwabEquity("SPY", { ...raw, realtime: false })?.source).toBe(
      "schwab-equity-delayed",
    );
    expect(
      parseSchwabEquity("SPY", { ...raw, realtime: undefined })?.source,
    ).toBe("schwab-equity-indicative");
    expect(
      parseSchwabEquity("SPY", {
        ...raw,
        quote: { tradeTime: now },
      })?.asOf.getTime(),
    ).toBe(0);
  });
  it.each([-1, NaN, Infinity, "123", null, undefined])(
    "does not normalize invalid price %s or invent a midpoint",
    (bidPrice) => {
      const parsed = parseSchwabEquity("SPY", {
        symbol: "SPY",
        assetMainType: "EQUITY",
        realtime: true,
        quote: { bidPrice, askPrice: 500 },
      });
      expect(parsed?.bid).toBeNull();
      expect(parsed?.mark).toBeNull();
    },
  );
  it("does not derive midpoint from crossed or zero sides", () => {
    expect(
      parseSchwabChainContract(row({ bidPrice: 20 }), "SPY", date, false)?.mark,
    ).toBeNull();
    expect(
      parseSchwabChainContract(row({ bidPrice: 0 }), "SPY", date, false)?.mark,
    ).toBeNull();
  });
  it("uses documented chain field names and omits unverified IV units", () => {
    const parsed = parseSchwabChainContract(row(), "SPY", date, false);
    expect(parsed).toMatchObject({
      contractSymbol: symbol,
      underlying: "SPY",
      right: "CALL",
      multiplier: 100,
      bid: 12,
      ask: 13,
      mark: 12.5,
      impliedVolatility: null,
      asOf: new Date(now),
      source: "schwab-option",
    });
    expect(parseSchwabChainContract(row(), "SPY", date, true)?.source).toBe(
      "schwab-option-delayed",
    );
    expect(
      parseSchwabChainContract(row(), "SPY", date, undefined)?.source,
    ).toBe("schwab-option-indicative");
  });
  it.each([
    { multiplier: 10 },
    { multiplier: 150 },
    { isMini: true },
    { isNonStandard: true },
    { isIndexOption: true },
    { isNonStandard: undefined },
    { isMini: undefined },
    { isIndexOption: undefined },
    { strikePrice: 501 },
    { putCall: "PUT" },
    { expirationDate: "2030-06-22" },
    { optionRoot: "SPY1" },
    { optionDeliverablesList: [{ symbol: "SPY", deliverableUnits: "150" }] },
    { deliverableNote: "cash plus shares" },
  ])("rejects contradictory or unsupported chain metadata %j", (extra) =>
    expect(parseSchwabChainContract(row(extra), "SPY", date, false)).toBeNull(),
  );
  it("loads documented standard chains without nonexistent underlying.assetType", async () => {
    vi.mocked(schwabGet).mockResolvedValue(chain());
    expect(
      await new SchwabOptionsProvider().getOptionChain("SPY", date),
    ).toHaveLength(1);
    expect(schwabGet).toHaveBeenCalledWith(
      "/chains",
      expect.objectContaining({
        symbol: "SPY",
        optionType: "S",
        includeUnderlyingQuote: "true",
      }),
    );
  });
  it.each([
    { isIndex: true },
    { isIndex: undefined },
    { underlying: { symbol: "OTHER" } },
    { symbol: "OTHER" },
    { callExpDateMap: { [date]: { "500": [row({ isMini: true })] } } },
  ])("fails clearly on unsupported or incomplete chains %j", async (extra) => {
    vi.mocked(schwabGet).mockResolvedValue(chain(extra));
    await expect(
      new SchwabOptionsProvider().getOptionChain("SPY", date),
    ).rejects.toThrow("Schwab:");
  });
  it("validates reference terms then uses a fresh individual quote timestamp and sides", async () => {
    vi.mocked(schwabGet)
      .mockResolvedValueOnce(chain())
      .mockResolvedValueOnce({ "SPY   300621C00500000": quote() });
    expect(
      await new SchwabOptionsProvider().getOptionQuote(symbol),
    ).toMatchObject({
      contractSymbol: symbol,
      bid: 14,
      ask: 15,
      source: "schwab-option",
      asOf: new Date(now + 100),
      impliedVolatility: null,
    });
    expect(schwabGet).toHaveBeenLastCalledWith("/quotes", {
      symbols: "SPY   300621C00500000",
      fields: "quote,reference",
      indicative: "false",
    });
  });
  it.each([
    { multiplier: 10 },
    { strikePrice: 501 },
    { contractType: "P" },
    { underlying: "$SPY" },
    { expirationYear: 2031 },
    { expirationMonth: 7 },
    { expirationDay: 20 },
    { deliverables: "150 SPY + cash" },
    { multiplier: undefined },
  ])("rejects contradictory single-quote reference %j", async (extra) => {
    vi.mocked(schwabGet)
      .mockResolvedValueOnce(chain())
      .mockResolvedValueOnce({
        [symbol]: quote({ reference: reference(extra) }),
      });
    expect(await new SchwabOptionsProvider().getOptionQuote(symbol)).toBeNull();
  });
  it("rejects wrong/duplicate individual identities and missing reference", async () => {
    for (const payload of [
      { [symbol]: quote({ symbol: "QQQ   300621C00500000" }) },
      { [symbol]: quote(), "SPY   300621C00500000": quote() },
      { [symbol]: quote({ reference: undefined }) },
    ]) {
      vi.mocked(schwabGet)
        .mockResolvedValueOnce(chain())
        .mockResolvedValueOnce(payload);
      expect(
        await new SchwabOptionsProvider().getOptionQuote(symbol),
      ).toBeNull();
    }
  });
  it("returns delayed/unknown fresh quote status faithfully instead of inheriting chain realtime", async () => {
    for (const realtime of [false, undefined]) {
      vi.mocked(schwabGet)
        .mockResolvedValueOnce(chain())
        .mockResolvedValueOnce({ [symbol]: quote({ realtime }) });
      expect(
        (await new SchwabOptionsProvider().getOptionQuote(symbol))?.source,
      ).toBe(
        realtime === false
          ? "schwab-option-delayed"
          : "schwab-option-indicative",
      );
    }
  });
  it("keeps future LEAPS, deduplicates dates and filters invalid/past expiration dates", async () => {
    vi.mocked(schwabGet).mockResolvedValue({
      expirationList: [
        date,
        "2032-01-16",
        date,
        "2028-01-21",
        "2030-02-30",
        "invalid",
      ].map((expirationDate) => ({ expirationDate })),
    });
    expect(await new SchwabOptionsProvider().getExpirations("SPY")).toEqual([
      date,
      "2032-01-16",
    ]);
  });
  it("equity batching preserves missing/mismatched instruments rather than relabeling", async () => {
    vi.mocked(schwabGet).mockResolvedValue({
      SPY: {
        symbol: "SPY",
        assetMainType: "EQUITY",
        realtime: true,
        quote: { quoteTime: now },
      },
      AAPL: { symbol: "MSFT", assetMainType: "EQUITY" },
    });
    expect(
      (await new SchwabEquityProvider().getQuotes(["SPY", "AAPL", "SPY"])).map(
        (q) => q.symbol,
      ),
    ).toEqual(["SPY"]);
    expect(schwabGet).toHaveBeenCalledTimes(1);
  });
  it("supports the named expiration schema alias but rejects contradictory dates", async () => {
    vi.mocked(schwabGet).mockResolvedValue({
      expirationList: [
        { expiration: date },
        { expirationDate: "2032-01-16", expiration: "2032-02-20" },
        { expiration: "2032-01-16" },
      ],
    });
    expect(await new SchwabOptionsProvider().getExpirations("SPY")).toEqual([
      date,
      "2032-01-16",
    ]);
    expect(
      canonicalSchwabOption("SPY " + " ".repeat(100) + "300621C00500000"),
    ).toBeNull();
  });
  it("invalid/missing/future quote times never become executable current time", () => {
    for (const value of [
      NaN,
      Infinity,
      -1,
      "123",
      null,
      undefined,
      999999999999999999,
    ])
      expect(schwabTime(value).getTime()).toBe(0);
    expect(isQuoteStale(schwabTime(now + 60000), 120, new Date(now))).toBe(
      true,
    );
  });
});

describe("exact Schwab source set", () => {
  it("permits display of exact delayed/unknown variants without accepting alternate providers or assets", () => {
    for (const expected of ["schwab-equity", "schwab-option"]) {
      for (const suffix of ["", "-delayed", "-indicative"])
        expect(acceptsQuoteSource(expected, expected + suffix)).toBe(true);
      for (const wrong of [
        "demo",
        "alpaca-sip",
        "tradier",
        expected + "-anything",
        expected === "schwab-equity" ? "schwab-option" : "schwab-equity",
      ])
        expect(acceptsQuoteSource(expected, wrong)).toBe(false);
    }
    expect(acceptsQuoteSource("demo", "schwab-equity")).toBe(false);
  });
});
