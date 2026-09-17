import { Prisma } from "@prisma/client";
import { afterEach, expect, it, vi } from "vitest";
import type { MarketQuote } from "@/server/domain/types";

vi.mock("@/server/services/quote-service", () => ({
  getLiveQuote: vi.fn(),
  quoteMark: (quote: MarketQuote | null) => quote?.mark ?? null,
}));
import { getLiveQuote } from "@/server/services/quote-service";
import { buildPositionProjection } from "@/server/services/projection-service";

const position = {
  id: "call",
  symbol: "AAPL270115C00100000",
  assetClass: "OPTION",
  quantity: new Prisma.Decimal(2),
  avgCost: new Prisma.Decimal(3),
  targetScenario: null,
  optionDetails: {
    underlying: "AAPL",
    strike: new Prisma.Decimal(100),
    right: "CALL",
    expiration: new Date("2027-01-15T20:00:00Z"),
    multiplier: 100,
  },
} as Parameters<typeof buildPositionProjection>[0];
const quote = (symbol: string, mark: number): MarketQuote => ({
  symbol,
  assetClass: symbol === "AAPL" ? "EQUITY" : "OPTION",
  mark,
  bid: mark,
  ask: mark,
  last: mark,
  source: "test",
  asOf: new Date(),
});
afterEach(() => vi.resetAllMocks());

it("starts the underlying read while a slow option quote is still pending", async () => {
  let finishOption!: (value: MarketQuote) => void;
  const slowOption = new Promise<MarketQuote>((resolve) => {
    finishOption = resolve;
  });
  vi.mocked(getLiveQuote).mockImplementation(async (symbol) =>
    symbol === "AAPL" ? quote(symbol, 180) : slowOption,
  );
  const pending = buildPositionProjection(position);
  expect(getLiveQuote).toHaveBeenCalledWith("AAPL", "EQUITY");
  finishOption(quote(position.symbol, 4));
  expect(await pending).toMatchObject({
    currentPrice: 4,
    currentMarketValue: 800,
    costBasis: 600,
    unrealizedPnL: 200,
    underlyingPrice: 180,
  });
});

it("keeps a missing option price labeled as cost basis while the underlying loads", async () => {
  vi.mocked(getLiveQuote).mockImplementation(async (symbol) =>
    symbol === "AAPL" ? quote(symbol, 180) : null,
  );
  expect(await buildPositionProjection(position)).toMatchObject({
    currentMarketValue: 600,
    currentPrice: null,
    valuationBasis: "COST_BASIS",
    priceEstimated: true,
    quoteStale: true,
    underlyingPrice: 180,
  });
});

it("uses one quote for an equity holding and its underlying", async () => {
  vi.mocked(getLiveQuote).mockResolvedValue(quote("AAPL", 180));
  const result = await buildPositionProjection({
    ...position,
    symbol: "AAPL",
    assetClass: "EQUITY",
    optionDetails: null,
  });
  expect(getLiveQuote).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ currentPrice: 180, underlyingPrice: 180 });
});
