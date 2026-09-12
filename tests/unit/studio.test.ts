import { afterEach, describe, expect, it, vi } from "vitest";
import type { Holding, Portfolio } from "@/lib/desk-types";
import {
  assetFromHolding,
  assumptionsSchema,
  csvCell,
  defaultAssumptions,
  defaultPreferences,
  journalSchema,
  scenarioSchema,
  snapshot,
  totalAt,
  validateWorkspaceValue,
  valueAt,
  type ScenarioAsset,
} from "@/lib/studio";
import {
  projectEquityValue,
  projectOptionIntrinsicValue,
  projectOptionModelValue,
  sumProjectedNetWorth,
} from "@/server/domain/projection";

const capturedAt = "2026-01-01T00:00:00.000Z";
const at = Date.parse(capturedAt);
const equity: ScenarioAsset = {
  id: "stock",
  portfolioId: "portfolio",
  symbol: "ABC",
  label: "ABC",
  quantity: 3.125,
  currentValue: 312.5,
  costBasis: 280,
  spot: 100,
  target: 123.456,
  option: null,
};
const call: ScenarioAsset = {
  ...equity,
  id: "call",
  label: "ABC $100 call",
  quantity: 3,
  currentValue: 1800,
  costBasis: 2100,
  target: 120,
  option: {
    strike: 100,
    expiration: "2027-01-15T21:00:00.000Z",
    right: "CALL",
    iv: 0.3,
    multiplier: 100,
  },
};
const put: ScenarioAsset = {
  ...call,
  id: "put",
  target: 80,
  option: { ...call.option!, right: "PUT" },
};
const holding: Holding = {
  id: call.id,
  portfolioId: call.portfolioId,
  symbol: "ABC270115C00100000",
  assetClass: "OPTION",
  quantity: call.quantity,
  avgCost: 7,
  optionDetails: {
    underlying: call.symbol,
    optionSymbol: "ABC270115C00100000",
    right: "CALL",
    strike: "100",
    expiration: call.option!.expiration,
    multiplier: 100,
  },
  targetScenario: {
    targetMode: "PRICE",
    targetPrice: "120",
    targetMarketCap: null,
    sharesOutstandingLive: null,
    sharesOutstandingManual: null,
    useManualShares: false,
  },
  projection: {
    currentMarketValue: 1800,
    currentPrice: 6,
    costBasis: 2100,
    unrealizedPnL: -300,
    targetUnderlyingPrice: 120,
    projectedValue: 0,
    optionIntrinsicProjectedValue: 6000,
    optionModelProjectedValue: null,
    hasTarget: true,
    priceEstimated: false,
    quoteStale: false,
    quoteAsOf: capturedAt,
    quoteSource: "demo",
    impliedVolatility: 0.3,
    ivEstimated: false,
    underlyingPrice: 100,
    expired: false,
  },
};
const portfolio: Portfolio = {
  id: "portfolio",
  name: "Long horizon",
  cashBalance: 10000,
  startingCash: 12100,
  currentValue: 11800,
  equitiesValue: 0,
  optionsValue: 1800,
  projectedNetWorth: 16000,
  intrinsicNetWorth: 16000,
  targetCount: 1,
  estimatedCount: 0,
  positions: [holding],
  orders: [],
  ledger: [],
};
const note = {
  id: "eb6a1421-98b5-4eb7-b0bc-17f5e3d83b85",
  holdingId: "stock",
  symbol: "ABC",
  title: "Investment thesis",
  body: "Evidence and assumptions",
  source: "https://example.com/report",
  reviewDate: "2028-02-29",
  revisions: [],
};

afterEach(() => vi.useRealTimers());

describe("scenario valuation", () => {
  it.each([call, put])(
    "normalizes legacy winter UTC hours consistently with the server for $id",
    (asset) => {
      const legacy = {
        ...asset,
        option: { ...asset.option!, expiration: "2027-01-15T20:00:00.000Z" },
      };
      const now = Date.parse("2027-01-15T20:30:00Z");
      const expected = projectOptionModelValue({
        right: legacy.option.right,
        strike: legacy.option.strike,
        contracts: legacy.quantity,
        multiplier: legacy.option.multiplier,
        targetUnderlyingPrice: legacy.target,
        impliedVolatility: legacy.option.iv,
        expiration: new Date("2027-01-15T21:00:00Z"),
        now: new Date(now),
      });
      expect(valueAt(legacy, 1, "model", undefined, now)).toBe(expected);
    },
  );
  it("retains current marks at zero progress and rounds equity targets like the server", () => {
    expect(valueAt(equity, -1, "model", undefined, at)).toBe(312.5);
    expect(valueAt(equity, 0.5, "model", undefined, at)).toBe(349.15);
    expect(valueAt(equity, 1, "model", undefined, at)).toBe(
      projectEquityValue(equity.quantity, equity.target),
    );
    expect(valueAt(equity, 2, "intrinsic", undefined, at)).toBe(385.8);
    expect(valueAt({ ...equity, target: 0 }, 1, "model", undefined, at)).toBe(
      0,
    );
  });

  it.each([call, put])(
    "matches the server model endpoint for $id contracts",
    (asset) => {
      const option = asset.option!;
      const expected = projectOptionModelValue({
        right: option.right,
        strike: option.strike,
        contracts: asset.quantity,
        multiplier: option.multiplier,
        targetUnderlyingPrice: asset.target,
        impliedVolatility: option.iv,
        expiration: new Date(option.expiration),
        now: new Date(at),
      });
      expect(valueAt(asset, 0, "model", undefined, at)).toBe(
        asset.currentValue,
      );
      expect(valueAt(asset, 1, "model", undefined, at)).toBe(expected);
      expect(valueAt(asset, 1, "intrinsic", undefined, at)).toBe(
        projectOptionIntrinsicValue(
          option.right,
          option.strike,
          asset.quantity,
          option.multiplier,
          asset.target,
        ),
      );
    },
  );

  it("keeps the observed option mark at the start of a nonlinear model curve", () => {
    const midpoint = valueAt(call, 0.5, "model", undefined, at);
    const linearMidpoint =
      (call.currentValue + valueAt(call, 1, "model", undefined, at)) / 2;
    expect(midpoint).toBeGreaterThan(call.currentValue);
    expect(Math.abs(midpoint - linearMidpoint)).toBeGreaterThan(1);
    for (let progress = 0; progress <= 1; progress += 0.01)
      expect(
        valueAt(call, progress, "model", undefined, at),
      ).toBeGreaterThanOrEqual(0);
  });

  it("uses a labeled endpoint comparison when the current underlying quote is unavailable", () => {
    const noSpot = { ...call, spot: null };
    const endpoint = valueAt(noSpot, 1, "model", undefined, at);
    expect(valueAt(noSpot, 0, "model", undefined, at)).toBe(call.currentValue);
    expect(
      Math.abs(
        valueAt(noSpot, 0.5, "model", undefined, at) -
          (call.currentValue + endpoint) / 2,
      ),
    ).toBeLessThanOrEqual(0.01);
  });

  it("applies IV, rate and elapsed-time assumptions to the model endpoint", () => {
    const assumptions = { rate: 0.075, iv: 0.55, daysForward: 90 };
    expect(valueAt(call, 1, "model", assumptions, at)).toBe(
      projectOptionModelValue({
        right: "CALL",
        strike: 100,
        contracts: 3,
        multiplier: 100,
        targetUnderlyingPrice: 120,
        impliedVolatility: 0.55,
        riskFreeRate: 0.075,
        expiration: new Date(call.option!.expiration),
        now: new Date(at + 90 * 86400000),
      }),
    );
    expect(valueAt(call, 0, "model", assumptions, at)).toBe(call.currentValue);
    expect(valueAt(call, 1, "intrinsic", assumptions, at)).toBe(6000);
  });

  it.each([call, put])(
    "falls back to intrinsic after expiration for $id contracts",
    (asset) => {
      const expiredAt = Date.parse(asset.option!.expiration) + 1;
      expect(valueAt(asset, 1, "model", undefined, expiredAt)).toBe(6000);
      expect(
        valueAt(
          asset,
          1,
          "model",
          { ...defaultAssumptions, daysForward: 400 },
          at,
        ),
      ).toBe(6000);
      expect(
        valueAt({ ...asset, target: 100 }, 1, "model", undefined, expiredAt),
      ).toBe(0);
    },
  );

  it("handles zero targets with the same option convention as the projection service", () => {
    expect(valueAt({ ...call, target: 0 }, 1, "model", undefined, at)).toBe(0);
    expect(valueAt({ ...put, target: 0 }, 1, "model", undefined, at)).toBe(
      Math.round(
        30000 *
          Math.exp(
            (-0.04 * (Date.parse(put.option!.expiration) - at)) /
              (365 * 86400000),
          ) *
          100,
      ) / 100,
    );
  });

  it("keeps cash and untargeted holdings unchanged under every assumption", () => {
    const untargeted = [
      { ...call, target: null },
      { ...equity, target: null },
    ];
    for (const mode of ["model", "intrinsic"] as const)
      for (const progress of [0, 0.4, 1])
        expect(
          totalAt(
            untargeted,
            10000.01,
            progress,
            mode,
            { rate: 0.3, iv: 2, daysForward: 1000 },
            at,
          ),
        ).toBe(12112.51);
    expect(totalAt([], 10000.01, 1, "model", undefined, at)).toBe(10000.01);
  });

  it("adds rounded position endpoints so chart totals agree with portfolio totals", () => {
    const positions = Array.from({ length: 12 }, (_, i) => ({
      ...equity,
      id: `stock-${i}`,
      quantity: 0.333,
      target: 100.01,
    }));
    const expected = sumProjectedNetWorth(
      12.34,
      positions.map((p) => projectEquityValue(p.quantity, p.target)),
    );
    expect(expected).toBe(411.94);
    expect(totalAt(positions, 12.34, 1, "model", undefined, at)).toBe(expected);
  });
});

describe("scenario snapshots", () => {
  it("captures underlying spot, deliverables and resolved targets for option holdings", () => {
    const asset = assetFromHolding(holding);
    expect(asset).toMatchObject({
      ...call,
      label: "ABC $100 call · 2027-01-15",
    });
    const untargeted = assetFromHolding({
      ...holding,
      projection: {
        ...holding.projection,
        hasTarget: false,
        impliedVolatility: null,
      },
    });
    expect(untargeted.target).toBeNull();
    expect(untargeted.option?.iv).toBe(0.6);
  });

  it("creates independent, schema-valid snapshots with a fixed model date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(at);
    const original = structuredClone(portfolio);
    const saved = snapshot([original], "January conviction");
    expect(scenarioSchema.parse(saved)).toEqual(saved);
    expect(saved.capturedAt).toBe(capturedAt);
    const savedAt = Date.parse(saved.capturedAt);
    const initial = totalAt(
      saved.assets,
      saved.cash,
      1,
      "model",
      saved.assumptions,
      savedAt,
    );
    original.cashBalance = 0;
    original.name = "Renamed";
    original.positions[0].projection.targetUnderlyingPrice = 0;
    original.positions[0].optionDetails!.multiplier = 50;
    vi.setSystemTime("2030-01-01T00:00:00.000Z");
    expect(saved.portfolioNames).toEqual(["Long horizon"]);
    expect(saved.cash).toBe(10000);
    expect(saved.assets[0].target).toBe(120);
    expect(saved.assets[0].option?.multiplier).toBe(100);
    expect(
      totalAt(saved.assets, saved.cash, 1, "model", saved.assumptions, savedAt),
    ).toBe(initial);
    expect(
      totalAt(saved.assets, saved.cash, 1, "model", saved.assumptions),
    ).not.toBe(initial);
    saved.assumptions.rate = 0.2;
    expect(defaultAssumptions.rate).toBe(0.04);
    expect(snapshot([], "Another").id).not.toBe(saved.id);
  });
});

describe("workspace value validation", () => {
  it("validates entry type and identity and strips unexpected persisted fields", () => {
    expect(
      validateWorkspaceValue("preferences", {
        ...defaultPreferences,
        userId: "another-user",
      }),
    ).toEqual(defaultPreferences);
    expect(validateWorkspaceValue(`note:${note.id}`, note)).toEqual(note);
    expect(() =>
      validateWorkspaceValue("note:fe00f2ce-20cc-4e16-a1d4-acd96883d39a", note),
    ).toThrow("Note ID does not match");
    const saved = snapshot([], "Saved");
    expect(validateWorkspaceValue(`scenario:${saved.id}`, saved)).toEqual(
      saved,
    );
    expect(() =>
      validateWorkspaceValue(
        "scenario:fe00f2ce-20cc-4e16-a1d4-acd96883d39a",
        saved,
      ),
    ).toThrow("Scenario ID does not match");
    expect(() => validateWorkspaceValue("other", {})).toThrow(
      "Unsupported workspace entry",
    );
  });

  it.each([NaN, Infinity, -Infinity, -1])(
    "rejects invalid financial values: %s",
    (bad) => {
      const saved = snapshot([], "Saved");
      expect(scenarioSchema.safeParse({ ...saved, cash: bad }).success).toBe(
        false,
      );
      expect(
        scenarioSchema.safeParse({
          ...saved,
          assets: [{ ...call, target: bad }],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects unsupported model assumptions and accepts documented boundaries", () => {
    for (const invalid of [
      { rate: 0.51 },
      { rate: -0.11 },
      { iv: 0 },
      { iv: 5.01 },
      { daysForward: -1 },
      { daysForward: 3651 },
    ])
      expect(
        assumptionsSchema.safeParse({ ...defaultAssumptions, ...invalid })
          .success,
      ).toBe(false);
    expect(
      assumptionsSchema.parse({ rate: -0.1, iv: 5, daysForward: 3650 }),
    ).toEqual({ rate: -0.1, iv: 5, daysForward: 3650 });
  });

  it("rejects invalid calendar dates and non-web evidence destinations", () => {
    for (const source of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "https://",
      "https://bad host/report",
    ])
      expect(journalSchema.safeParse({ ...note, source }).success).toBe(false);
    for (const reviewDate of [
      "2026-02-29",
      "2026-02-31",
      "2026-13-01",
      "2026-00-10",
    ])
      expect(journalSchema.safeParse({ ...note, reviewDate }).success).toBe(
        false,
      );
    expect(
      journalSchema.parse({ ...note, source: " https://example.com/report " })
        .source,
    ).toBe(note.source);
    expect(
      journalSchema.safeParse({ ...note, source: "", reviewDate: "" }).success,
    ).toBe(true);
    expect(journalSchema.safeParse(note).success).toBe(true);
  });
});

describe("safe CSV exports", () => {
  it.each([
    "=SUM(A1:A2)",
    "+CMD()",
    "-CMD()",
    "@SUM(A1:A2)",
    "  =1+1",
    "\t=1+1",
    "\r=1+1",
    "\n+1+1",
  ])("neutralizes spreadsheet formulas in text: %j", (text) => {
    expect(csvCell(text)).toBe(`"'${text}"`);
  });

  it("preserves numeric cash outflows and escapes quotes, commas and line breaks", () => {
    expect(csvCell(-72971.4)).toBe('"-72971.4"');
    expect(csvCell("-72971.40")).toBe('"-72971.40"');
    expect(csvCell(0)).toBe('"0"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell('One, "two"\nthree')).toBe('"One, ""two""\nthree"');
  });
});
