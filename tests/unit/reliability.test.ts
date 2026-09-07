import { describe, expect, it } from "vitest";
import {
  AssetClass,
  OrderType,
  Side,
  OptionRight,
  TargetMode,
} from "@prisma/client";
import { decideFill } from "@/server/domain/fill-engine";
import {
  deriveTargetPriceFromScenario,
  projectEquityValue,
  projectOptionIntrinsicValue,
  projectOptionModelValue,
} from "@/server/domain/projection";
import { orderTicketSchema, targetScenarioSchema } from "@/server/api/schemas";
const ticket = {
  portfolioId: "p",
  assetClass: AssetClass.EQUITY,
  symbol: "TSLA",
  side: Side.BUY,
  orderType: OrderType.MARKET,
  quantity: 2,
};
const quote = {
  symbol: "TSLA",
  assetClass: AssetClass.EQUITY,
  bid: 100,
  ask: 101,
  last: 100.5,
  mark: 100.5,
  source: "test",
  asOf: new Date(),
};
describe("trading guardrails", () => {
  it.each([NaN, Infinity, -1, 0])("rejects invalid quantity %s", (quantity) =>
    expect(decideFill({ ...ticket, quantity }, quote).fillable).toBe(false),
  );
  it("does not invent an ask from the last trade", () =>
    expect(decideFill(ticket, { ...quote, ask: null }).fillable).toBe(false));
  it("rejects crossed bid/ask", () =>
    expect(decideFill(ticket, { ...quote, bid: 102 }).fillable).toBe(false));
  it("requires integer options contracts", () =>
    expect(
      orderTicketSchema.safeParse({
        ...ticket,
        assetClass: "OPTION",
        quantity: 0.5,
        optionContractSymbol: "BTG270115C00005000",
        optionRight: "CALL",
        optionStrike: 5,
        optionExpiration: "2027-01-15",
      }).success,
    ).toBe(false));
  it("fills sell limits only at or above limit", () => {
    expect(
      decideFill(
        {
          ...ticket,
          side: Side.SELL,
          orderType: OrderType.LIMIT,
          limitPrice: 100,
        },
        quote,
      ).fillable,
    ).toBe(true);
    expect(
      decideFill(
        {
          ...ticket,
          side: Side.SELL,
          orderType: OrderType.LIMIT,
          limitPrice: 101,
        },
        quote,
      ).fillable,
    ).toBe(false);
  });
});
describe("vision scenarios", () => {
  it("values 228 TSLA shares at $2000", () =>
    expect(projectEquityValue(228, 2000)).toBe(456000));
  it("values 600 BTG $5 calls at a $50B valuation", () => {
    const target = deriveTargetPriceFromScenario({
      targetMode: TargetMode.MARKET_CAP,
      targetMarketCap: 50e9,
      useManualShares: true,
      sharesOutstandingManual: 1.35e9,
    });
    expect(target).toBeCloseTo(37.037037);
    expect(
      projectOptionIntrinsicValue(OptionRight.CALL, 5, 600, 100, target),
    ).toBe(1922222.22);
  });
  it("honors a zero-dollar downside target", () => {
    expect(
      targetScenarioSchema.safeParse({ targetMode: "PRICE", targetPrice: 0 })
        .success,
    ).toBe(true);
    expect(projectEquityValue(100, 0)).toBe(0);
    expect(projectOptionIntrinsicValue(OptionRight.PUT, 5, 2, 100, 0)).toBe(
      1000,
    );
  });
  it("does not silently ignore an invalid manual override", () =>
    expect(
      deriveTargetPriceFromScenario({
        targetMode: TargetMode.MARKET_CAP,
        targetMarketCap: 1e9,
        useManualShares: true,
        sharesOutstandingManual: 0,
        sharesOutstandingLive: 1e8,
      }),
    ).toBe(null));
  it("collapses expired options to target intrinsic", () =>
    expect(
      projectOptionModelValue({
        right: OptionRight.PUT,
        strike: 10,
        contracts: 3,
        multiplier: 100,
        targetUnderlyingPrice: 4,
        impliedVolatility: 0.6,
        expiration: new Date("2020-01-01"),
      }),
    ).toBe(1800));
});
