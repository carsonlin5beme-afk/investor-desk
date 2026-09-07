import { OptionRight, TargetMode } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  deriveTargetPriceFromScenario,
  projectOptionIntrinsicValue,
  projectOptionModelValue,
  sumProjectedNetWorth,
} from "@/server/domain/projection";

describe("projection math", () => {
  it("derives target share price from market cap and shares outstanding", () => {
    const target = deriveTargetPriceFromScenario({
      targetMode: TargetMode.MARKET_CAP,
      targetMarketCap: 50_000_000_000,
      sharesOutstandingLive: 10_000_000_000,
      sharesOutstandingManual: null,
      useManualShares: false,
    });

    expect(target).toBe(5);
  });

  it("uses manual shares outstanding override when enabled", () => {
    const target = deriveTargetPriceFromScenario({
      targetMode: TargetMode.MARKET_CAP,
      targetMarketCap: 50_000_000_000,
      sharesOutstandingLive: 10_000_000_000,
      sharesOutstandingManual: 5_000_000_000,
      useManualShares: true,
    });

    expect(target).toBe(10);
  });

  it("computes options intrinsic projections and model fallback at expiration", () => {
    const intrinsic = projectOptionIntrinsicValue(
      OptionRight.CALL,
      100,
      2,
      100,
      120,
    );
    expect(intrinsic).toBe(4000);

    const modelExpired = projectOptionModelValue({
      right: OptionRight.CALL,
      strike: 100,
      contracts: 1,
      multiplier: 100,
      targetUnderlyingPrice: 120,
      impliedVolatility: 0.5,
      expiration: new Date(Date.now() - 1000),
    });

    expect(modelExpired).toBe(2000);
  });

  it("aggregates projected net worth using simultaneous holding targets", () => {
    const netWorth = sumProjectedNetWorth(10_000, [5000, null, 4200]);
    expect(netWorth).toBe(19200);
  });
});
