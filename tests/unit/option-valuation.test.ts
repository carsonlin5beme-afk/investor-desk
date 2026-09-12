import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({
  prisma: {
    quoteCache: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
  },
}));
vi.mock("@/server/providers/factory", () => ({
  quoteSourceFor: (asset: string) =>
    asset === "OPTION" ? "alpaca-opra" : "alpaca-sip",
  providers: {
    options: { getOptionQuote: vi.fn() },
    equities: { getQuote: vi.fn(async () => null) },
  },
}));
import { prisma } from "@/lib/prisma";
import { providers } from "@/server/providers/factory";
import { parseAlpacaOption } from "@/server/providers/alpaca-options";
import { buildPositionProjection } from "@/server/services/projection-service";
import { getLiveQuote, quoteMark } from "@/server/services/quote-service";
import { decideFill } from "@/server/domain/fill-engine";
const D = Prisma.Decimal;
const symbol = "AAPL270115C00100000";
const position = {
  id: "held",
  symbol,
  assetClass: "OPTION",
  quantity: new D(1),
  avgCost: new D(1),
  targetScenario: null,
  optionDetails: {
    underlying: "AAPL",
    strike: new D(100),
    right: "CALL",
    expiration: new Date("2027-01-15T20:00:00Z"),
    multiplier: 100,
  },
} as Parameters<typeof buildPositionProjection>[0];
function quote(
  bid: number | undefined,
  ask: number | undefined,
  last: number | undefined,
  timestamp: string | undefined = new Date().toISOString(),
) {
  return parseAlpacaOption(
    {
      symbol,
      underlying_symbol: "AAPL",
      root_symbol: "AAPL",
      type: "call",
      strike_price: "100",
      expiration_date: "2027-01-15",
      size: "100",
      status: "active",
    },
    {
      latestQuote: { bp: bid, ap: ask, t: timestamp },
      latestTrade: { p: last, t: "2026-01-01T12:00:00Z" },
      impliedVolatility: 0.3,
    },
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T16:00:00Z"));
  vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.quoteCache.upsert).mockClear();
});
afterEach(() => vi.useRealTimers());

it.each([5, undefined])(
  "uses the current zero-bid book instead of a historical last=%s",
  async (last) => {
    vi.mocked(providers.options.getOptionQuote).mockResolvedValue(
      quote(0, 0.02, last),
    );
    const projection = await buildPositionProjection(position);
    expect(projection).toMatchObject({
      currentPrice: 0.01,
      currentMarketValue: 1,
      valuationBasis: "OPTION_MIDPOINT",
      priceEstimated: false,
      quoteStale: false,
      quoteAsOf: new Date().toISOString(),
      unrealizedPnL: -99,
    });
    const live = await getLiveQuote(symbol, "OPTION", true);
    expect(
      decideFill(
        {
          portfolioId: "fixture",
          symbol: "AAPL",
          assetClass: "OPTION",
          side: "SELL",
          quantity: 1,
          orderType: "MARKET",
        },
        live!,
      ).fillable,
    ).toBe(false);
  },
);

it.each([
  [undefined, 0.02],
  [0, undefined],
  [2, 1],
  [undefined, undefined],
  [0, 0],
])(
  "labels cost basis when the option book %s/%s cannot value the holding",
  async (bid, ask) => {
    vi.mocked(providers.options.getOptionQuote).mockResolvedValue(
      quote(bid, ask, 5),
    );
    expect(await buildPositionProjection(position)).toMatchObject({
      currentPrice: null,
      currentMarketValue: 100,
      priceEstimated: true,
      valuationBasis: "COST_BASIS",
      quoteAsOf: null,
    });
  },
);

it("uses an ordinary two-sided midpoint and retains stale/unknown quote timestamps", async () => {
  vi.mocked(providers.options.getOptionQuote).mockResolvedValue(
    quote(3, 4, 500, "2026-08-01T16:00:00Z"),
  );
  expect(await buildPositionProjection(position)).toMatchObject({
    currentPrice: 3.5,
    currentMarketValue: 350,
    valuationBasis: "OPTION_MIDPOINT",
    quoteStale: true,
    quoteAsOf: "2026-08-01T16:00:00.000Z",
  });
  const missing = quote(3, 4, 5);
  missing.asOf = new Date(0);
  vi.mocked(providers.options.getOptionQuote).mockResolvedValue(missing);
  expect(await buildPositionProjection(position)).toMatchObject({
    currentPrice: 3.5,
    quoteStale: true,
    quoteAsOf: "1970-01-01T00:00:00.000Z",
  });
});

it("does not trust an older option cache mark that borrowed the trade price", async () => {
  vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue({
    symbol,
    assetClass: "OPTION",
    bid: new D(0),
    ask: new D(0.02),
    mark: new D(5),
    last: new D(5),
    source: "alpaca-opra",
    asOf: new Date(),
    updatedAt: new Date(),
    impliedVolatility: 0.3,
  } as never);
  expect(await buildPositionProjection(position)).toMatchObject({
    currentPrice: 0.01,
    currentMarketValue: 1,
    valuationBasis: "OPTION_MIDPOINT",
  });
  expect((await getLiveQuote(symbol, "OPTION"))?.mark).toBe(0.01);
  expect(
    quoteMark({
      symbol: "AAPL",
      assetClass: "EQUITY",
      bid: null,
      ask: null,
      mark: null,
      last: 5,
      asOf: new Date(),
      source: "alpaca-sip",
    }),
  ).toBe(5);
});

it.each([
  "2030-01-18T21:14:59Z",
  "2030-01-18T21:15:00Z",
  "2030-01-18T23:59:59Z",
])(
  "preserves assumed expiry provenance throughout an unknown expiry day at %s",
  async (instant) => {
    vi.setSystemTime(new Date(instant));
    vi.mocked(providers.options.getOptionQuote).mockResolvedValue(null);
    const unknown = {
      ...position,
      symbol: "SPY300118P00100000",
      optionDetails: {
        ...position.optionDetails!,
        underlying: "SPY",
        expiration: new Date("2030-01-18T20:00:00Z"),
      },
    };
    expect(await buildPositionProjection(unknown)).toMatchObject({
      expired: false,
      expirationAssumed: true,
    });
  },
);
