import { createMonthlyPlan } from "@/lib/monthly-scenario";
import type { Portfolio } from "@/lib/desk-types";
import {
  defaultAssumptions,
  type SavedScenario,
  type ScenarioAsset,
} from "@/lib/studio";

export function monthlyFixture(): SavedScenario {
  const stock: ScenarioAsset = {
    id: "btg-stock",
    portfolioId: "fixture-portfolio",
    symbol: "BTG",
    label: "BTG",
    quantity: 100,
    currentValue: 500,
    costBasis: 400,
    spot: 5,
    target: 10,
    option: null,
    quoteQuality: {
      estimated: false,
      stale: false,
      asOf: "2026-09-17T16:00:00.000Z",
      source: "demo",
      ivEstimated: false,
    },
  };
  const option: ScenarioAsset = {
    ...stock,
    id: "btg-call",
    label: "BTG $5 call · 2026-12-18",
    quantity: 600,
    currentValue: 109200,
    costBasis: 109800,
    option: {
      strike: 5,
      expiration: "2026-12-18T21:00:00.000Z",
      right: "CALL",
      iv: 0.6,
      multiplier: 100,
    },
  };
  const assets = [stock, option],
    capturedAt = "2026-09-17T16:00:00.000Z";
  const monthly = createMonthlyPlan(assets, capturedAt, 4);
  monthly.paths[0].prices = [6, 8, 9, 15];
  return {
    id: "3edb6b8c-88ee-45bb-b672-e20b699ef3a7",
    name: "BTG monthly thesis",
    notes: "Synthetic fixture",
    capturedAt,
    portfolioNames: ["Options"],
    cash: 1000,
    assets,
    assumptions: { ...defaultAssumptions },
    monthly,
  };
}

export function monthlyPortfolioFixture(): Portfolio {
  const scenario = monthlyFixture();
  return {
    id: "fixture-portfolio",
    name: "Options",
    cashBalance: 1000,
    startingCash: 111200,
    currentValue: 110700,
    equitiesValue: 500,
    optionsValue: 109200,
    projectedNetWorth: 0,
    intrinsicNetWorth: 0,
    targetCount: 2,
    estimatedCount: 0,
    orders: [],
    ledger: [],
    positions: scenario.assets.map((asset) => ({
      id: asset.id,
      portfolioId: asset.portfolioId,
      symbol: asset.symbol,
      assetClass: asset.option ? "OPTION" : "EQUITY",
      quantity: asset.quantity,
      avgCost:
        asset.costBasis / asset.quantity / (asset.option?.multiplier ?? 1),
      optionDetails: asset.option
        ? {
            underlying: asset.symbol,
            optionSymbol: "BTG261218C00005000",
            right: asset.option.right,
            strike: String(asset.option.strike),
            expiration: asset.option.expiration,
            multiplier: asset.option.multiplier,
          }
        : null,
      targetScenario: null,
      projection: {
        currentMarketValue: asset.currentValue,
        currentPrice:
          asset.currentValue / asset.quantity / (asset.option?.multiplier ?? 1),
        costBasis: asset.costBasis,
        unrealizedPnL: asset.currentValue - asset.costBasis,
        targetUnderlyingPrice: 10,
        projectedValue: 0,
        optionIntrinsicProjectedValue: null,
        optionModelProjectedValue: null,
        hasTarget: true,
        priceEstimated: false,
        quoteStale: false,
        quoteAsOf: scenario.capturedAt,
        quoteSource: "demo",
        impliedVolatility: asset.option?.iv ?? null,
        ivEstimated: false,
        underlyingPrice: asset.spot,
        expired: false,
      },
    })),
  };
}
