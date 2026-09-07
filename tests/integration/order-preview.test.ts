import { AssetClass, OrderType, Side, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({
  prisma: {
    portfolio: {
      findUnique: vi.fn(async () => ({
        id: "portfolio-1",
        cashBalance: new Prisma.Decimal(250000),
      })),
    },
    position: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/server/services/quote-service", () => ({
  getLiveQuote: vi.fn(async () => ({
    symbol: "TSLA",
    assetClass: AssetClass.EQUITY,
    bid: 199,
    ask: 201,
    last: 200,
    mark: 200,
    source: "mock",
    asOf: new Date(),
  })),
}));
import { previewOrder } from "@/server/services/order-service";
const ticket = {
  portfolioId: "portfolio-1",
  assetClass: AssetClass.EQUITY,
  symbol: "TSLA",
  side: Side.BUY,
  orderType: OrderType.MARKET,
  quantity: 5,
};
describe("order preview service", () => {
  it("returns bid/ask fill, notional and remaining cash", async () => {
    const p = await previewOrder(ticket);
    expect(p.fillable).toBe(true);
    expect(p.estimatedFillPrice).toBe(201);
    expect(p.estimatedNotional).toBe(1005);
    expect(p.cashAfter).toBe(248995);
  });
  it("rejects uncrossed limits", async () => {
    const p = await previewOrder({
      ...ticket,
      orderType: OrderType.LIMIT,
      limitPrice: 150,
    });
    expect(p.fillable).toBe(false);
    expect("reason" in p && p.reason).toMatch(/not crossed/i);
  });
  it("validates buying power during preview", async () => {
    await expect(previewOrder({ ...ticket, quantity: 1e6 })).rejects.toThrow(
      /Insufficient cash/,
    );
  });
  it("rejects selling an unowned position", async () => {
    await expect(previewOrder({ ...ticket, side: Side.SELL })).rejects.toThrow(
      /Cannot sell/,
    );
  });
});

describe("quote freshness checks", () => {
  it.each([
    { source: "tradier-delayed", asOf: new Date() },
    { source: "alpaca-indicative", asOf: new Date() },
    { source: "alpaca-sip", asOf: new Date(0) },
    { source: "alpaca-sip", asOf: new Date("invalid") },
    { source: "alpaca-sip", asOf: new Date(Date.now() + 60000) },
  ])(
    "blocks non-executable source or timestamp: $source $asOf",
    async (quality) => {
      const { getLiveQuote } = await import("@/server/services/quote-service");
      vi.mocked(getLiveQuote).mockResolvedValueOnce({
        symbol: "TSLA",
        assetClass: AssetClass.EQUITY,
        bid: 199,
        ask: 201,
        last: 200,
        mark: 200,
        ...quality,
      });
      await expect(previewOrder(ticket)).rejects.toThrow(/stale or delayed/);
    },
  );
});
