import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { OrderTicket } from "@/server/domain/types";
vi.mock("@/lib/prisma", () => ({
  prisma: { quoteCache: { findUnique: vi.fn(), upsert: vi.fn() } },
}));
vi.mock("@/server/providers/schwab-client", () => ({ schwabGet: vi.fn() }));
vi.mock("@/server/providers/factory", async () => {
  const { SchwabEquityProvider, SchwabOptionsProvider } =
    await import("@/server/providers/schwab");
  return {
    providers: {
      equities: new SchwabEquityProvider(),
      options: new SchwabOptionsProvider(),
    },
    quoteSourceFor: (asset: string) =>
      asset === "EQUITY" ? "schwab-equity" : "schwab-option",
  };
});
import { prisma } from "@/lib/prisma";
import { schwabGet } from "@/server/providers/schwab-client";
import { resolveTicket } from "@/server/services/order-service";
import { getQuoteResult } from "@/server/services/quote-service";
import { estimateOrderNotional } from "@/server/domain/fill-engine";
const date = "2030-06-21",
  contract = "SPY300621C00500000";
const equityTicket: OrderTicket = {
  portfolioId: "synthetic-portfolio",
  assetClass: "EQUITY",
  symbol: "SPY",
  side: "BUY",
  quantity: 2,
  orderType: "MARKET",
};
const optionTicket: OrderTicket = {
  ...equityTicket,
  assetClass: "OPTION",
  optionContractSymbol: contract,
  optionRight: "CALL",
  optionStrike: 500,
  optionExpiration: new Date(date + "T20:00:00Z"),
};
let realtime: boolean | undefined, timestamp: number, bid: number, ask: number;
const rawQuote = () => ({ bidPrice: bid, askPrice: ask, quoteTime: timestamp });
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  realtime = true;
  timestamp = Date.now();
  bid = 10;
  ask = 11;
  vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue(null);
  vi.mocked(schwabGet).mockImplementation(async (path, params) => {
    if (path === "/chains")
      return {
        symbol: "SPY",
        underlying: { symbol: "SPY" },
        status: "SUCCESS",
        isIndex: false,
        isDelayed: false,
        callExpDateMap: {
          [date + ":1"]: {
            "500": [
              {
                symbol: "SPY   300621C00500000",
                optionRoot: "SPY",
                putCall: "CALL",
                strikePrice: 500,
                multiplier: 100,
                isNonStandard: false,
                isMini: false,
                isIndexOption: false,
                expirationDate: date,
                quoteTimeInLong: timestamp,
                bidPrice: bid,
                askPrice: ask,
              },
            ],
          },
        },
      };
    if (params?.symbols === "SPY")
      return {
        SPY: {
          symbol: "SPY",
          assetMainType: "EQUITY",
          realtime,
          quote: rawQuote(),
        },
      };
    return {
      "SPY   300621C00500000": {
        symbol: "SPY   300621C00500000",
        assetMainType: "OPTION",
        realtime,
        quote: rawQuote(),
        reference: {
          underlying: "SPY",
          multiplier: 100,
          strikePrice: 500,
          contractType: "C",
          expirationYear: 2030,
          expirationMonth: 6,
          expirationDay: 21,
        },
      },
    };
  });
});
afterEach(() => vi.restoreAllMocks());

describe("Schwab adapters through simulated order resolution", () => {
  it.each([equityTicket, optionTicket])(
    "buys ask, sells bid and retains multiplier accounting for $assetClass",
    async (ticket) => {
      const buy = await resolveTicket(ticket),
        sell = await resolveTicket({ ...ticket, side: "SELL" });
      expect(buy.decision).toMatchObject({ fillable: true, fillPrice: 11 });
      expect(sell.decision).toMatchObject({ fillable: true, fillPrice: 10 });
      expect(estimateOrderNotional(ticket, 11)).toBe(
        ticket.assetClass === "OPTION" ? 2200 : 22,
      );
      expect(prisma.quoteCache.upsert).toHaveBeenCalled();
    },
  );
  it.each([false, undefined])(
    "blocks explicit delayed or unknown realtime %s for equities and options",
    async (value) => {
      realtime = value;
      for (const ticket of [equityTicket, optionTicket])
        await expect(resolveTicket(ticket)).rejects.toThrow("stale or delayed");
    },
  );
  it.each([0, -999999, 60000])(
    "rejects missing/stale/future timestamp delta %s",
    async (delta) => {
      timestamp = delta === 0 ? 0 : Date.now() + delta;
      await expect(resolveTicket(equityTicket)).rejects.toThrow(
        "stale or delayed",
      );
    },
  );
  it("rejects zero executable sides and crossed quotes", async () => {
    ask = 0;
    expect((await resolveTicket(equityTicket)).decision.fillable).toBe(false);
    bid = 12;
    ask = 11;
    expect((await resolveTicket(optionTicket)).decision.fillable).toBe(false);
  });
  it.each([
    "demo",
    "alpaca-sip",
    "tradier",
    "schwab-equity-delayed",
    "schwab-equity-indicative",
    "schwab-option",
  ])("never reuses incompatible cached source %s", async (source) => {
    vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue({
      symbol: "SPY",
      assetClass: "EQUITY",
      source,
      bid: new Prisma.Decimal(99),
      ask: new Prisma.Decimal(100),
      last: null,
      mark: new Prisma.Decimal(99.5),
      impliedVolatility: null,
      asOf: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(schwabGet).mockRejectedValueOnce(
      new Error("Schwab: synthetic unavailable"),
    );
    expect((await getQuoteResult("SPY", "EQUITY")).quote).toBeNull();
  });
  it("forced refresh cannot authorize a fill from matching cache after provider failure", async () => {
    vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue({
      symbol: "SPY",
      assetClass: "EQUITY",
      source: "schwab-equity",
      bid: new Prisma.Decimal(99),
      ask: new Prisma.Decimal(100),
      last: null,
      mark: new Prisma.Decimal(99.5),
      impliedVolatility: null,
      asOf: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(schwabGet).mockRejectedValueOnce(
      new Error("Schwab: synthetic unavailable"),
    );
    await expect(resolveTicket(equityTicket)).rejects.toThrow(
      "No quote available",
    );
  });
});
