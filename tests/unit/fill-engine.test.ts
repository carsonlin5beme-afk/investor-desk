import { AssetClass, OrderType, Side } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  decideFill,
  estimateOrderNotional,
  hasSufficientCashForBuy,
} from "@/server/domain/fill-engine";
import { OrderTicket } from "@/server/domain/types";

const baseTicket: OrderTicket = {
  portfolioId: "p1",
  assetClass: AssetClass.EQUITY,
  symbol: "TSLA",
  side: Side.BUY,
  orderType: OrderType.MARKET,
  quantity: 10,
};

describe("fill-engine", () => {
  it("uses ask for market buy and bid for market sell", () => {
    const quote = {
      symbol: "TSLA",
      assetClass: AssetClass.EQUITY,
      bid: 199,
      ask: 201,
      last: 200,
      mark: 200,
      source: "test",
      asOf: new Date(),
    };

    expect(decideFill(baseTicket, quote)).toEqual({
      fillable: true,
      fillPrice: 201,
    });
    expect(decideFill({ ...baseTicket, side: Side.SELL }, quote)).toEqual({
      fillable: true,
      fillPrice: 199,
    });
  });

  it("fills buy limit only when ask crosses limit", () => {
    const quote = {
      symbol: "TSLA",
      assetClass: AssetClass.EQUITY,
      bid: 199,
      ask: 201,
      last: 200,
      mark: 200,
      source: "test",
      asOf: new Date(),
    };

    expect(
      decideFill(
        { ...baseTicket, orderType: OrderType.LIMIT, limitPrice: 200.5 },
        quote,
      ).fillable,
    ).toBe(false);
    expect(
      decideFill(
        { ...baseTicket, orderType: OrderType.LIMIT, limitPrice: 201 },
        quote,
      ),
    ).toEqual({ fillable: true, fillPrice: 201 });
  });

  it("calculates order notional with options multiplier and validates cash", () => {
    const notional = estimateOrderNotional(
      {
        ...baseTicket,
        assetClass: AssetClass.OPTION,
        quantity: 3,
      },
      2.5,
    );

    expect(notional).toBe(750);
    expect(hasSufficientCashForBuy(700, notional)).toBe(false);
    expect(hasSufficientCashForBuy(750, notional)).toBe(true);
  });
});

// Preview, saved and guest ledgers, and duplicate-order responses share this calculation.
describe("decimal cash rounding", () => {
  it.each([
    [9.7, 320.05, 3104.49],
    [0.7, 319.95, 223.97],
    [1, 1.005, 1.01],
    [10000, 1.2345678, 12345.68],
  ])(
    "rounds %s shares at %s consistently with stored fills",
    (quantity, price, expected) => {
      expect(estimateOrderNotional({ ...baseTicket, quantity }, price)).toBe(
        expected,
      );
    },
  );
});
