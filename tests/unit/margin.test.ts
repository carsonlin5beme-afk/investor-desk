import { describe, expect, it } from "vitest";
import {
  aggregateMargin,
  defaultMarginSettings,
  elapsedMarginDays,
  marginSettingsSchema,
  projectMarginDebt,
  resolveMarginSettings,
  summarizeMargin,
  type MarginSettings,
  type MarginSummary,
} from "@/lib/margin";

const terms: MarginSettings = {
  debt: 10000,
  aprPercent: 12,
  maintenancePercent: 30,
  dayCountBasis: 360,
};
const zeroSummary: MarginSummary = {
  debt: 0,
  grossValue: 0,
  netEquity: 0,
  marginEquity: 0,
  maintenanceRequired: 0,
  maintenanceExcess: 0,
  maintenanceShortfall: 0,
};

describe("complete margin settings", () => {
  it("copies legacy defaults without adding terms to a provided object", () => {
    expect(defaultMarginSettings).toEqual({
      debt: 0,
      aprPercent: 0,
      maintenancePercent: 25,
      dayCountBasis: 360,
    });
    const omitted = resolveMarginSettings();
    const legacy = resolveMarginSettings(null);
    expect(omitted).toEqual(defaultMarginSettings);
    expect(legacy).toEqual(defaultMarginSettings);
    expect(omitted).not.toBe(defaultMarginSettings);
    expect(legacy).not.toBe(omitted);
    omitted.debt = 99;
    expect(legacy.debt).toBe(0);
    expect(defaultMarginSettings.debt).toBe(0);

    const source = Object.freeze({ ...terms });
    const resolved = resolveMarginSettings(source);
    expect(resolved).toEqual(source);
    expect(resolved).not.toBe(source);
    resolved.aprPercent = 999;
    expect(source.aprPercent).toBe(12);
  });

  it.each([
    "debt",
    "aprPercent",
    "maintenancePercent",
    "dayCountBasis",
  ] as const)("requires the explicit %s setting", (field) => {
    const incomplete: Partial<MarginSettings> = { ...terms };
    delete incomplete[field];
    expect(marginSettingsSchema.safeParse(incomplete).success).toBe(false);
    expect(() => resolveMarginSettings(incomplete as MarginSettings)).toThrow();
  });

  it.each([
    { ...terms, debt: 0 },
    { ...terms, debt: 0.01 },
    { ...terms, debt: 100.03 },
    { ...terms, debt: 999999999999.99 },
    { ...terms, debt: 1e12 },
    { ...terms, aprPercent: 0 },
    { ...terms, aprPercent: 10000 },
    { ...terms, aprPercent: Number.MAX_VALUE },
    { ...terms, maintenancePercent: 25 },
    { ...terms, maintenancePercent: 25.125 },
    { ...terms, maintenancePercent: 100 },
    { ...terms, dayCountBasis: 365 },
  ])("preserves valid boundary settings %j", (settings) => {
    expect(marginSettingsSchema.parse(settings)).toEqual(settings);
  });

  it.each([
    ["extra fields", { ...terms, borrowing: true }],
    ["negative debt", { ...terms, debt: -1 }],
    ["over-limit debt", { ...terms, debt: 1e12 + 0.01 }],
    ["fractional cents", { ...terms, debt: 0.001 }],
    ["tiny fractional cents", { ...terms, debt: 1e-8 }],
    ["subnormal fractional cents", { ...terms, debt: Number.MIN_VALUE }],
    ["large fractional cents", { ...terms, debt: 999999999999.999 }],
    ["NaN debt", { ...terms, debt: NaN }],
    ["infinite debt", { ...terms, debt: Infinity }],
    ["string debt", { ...terms, debt: "10000" }],
    ["null debt", { ...terms, debt: null }],
    ["negative APR", { ...terms, aprPercent: -0.01 }],
    ["NaN APR", { ...terms, aprPercent: NaN }],
    ["infinite APR", { ...terms, aprPercent: Infinity }],
    ["string APR", { ...terms, aprPercent: "12" }],
    ["low maintenance", { ...terms, maintenancePercent: 24.99 }],
    ["high maintenance", { ...terms, maintenancePercent: 100.01 }],
    ["NaN maintenance", { ...terms, maintenancePercent: NaN }],
    ["infinite maintenance", { ...terms, maintenancePercent: Infinity }],
    ["other basis", { ...terms, dayCountBasis: 364 }],
    ["string basis", { ...terms, dayCountBasis: "360" }],
    ["null basis", { ...terms, dayCountBasis: null }],
    ["empty object", {}],
  ])("refuses %s rather than sanitizing explicit terms", (_, settings) => {
    expect(marginSettingsSchema.safeParse(settings).success).toBe(false);
    expect(() => resolveMarginSettings(settings as MarginSettings)).toThrow();
    expect(
      summarizeMargin(1000, 20000, 5000, settings as MarginSettings),
    ).toBeNull();
    expect(projectMarginDebt(settings as MarginSettings, 30)).toBeNull();
  });
});

describe("conservative margin summaries", () => {
  it("subtracts existing debt once without changing cash or adding current interest", () => {
    expect(summarizeMargin(0, 20000, 0, terms)).toEqual({
      debt: 10000,
      grossValue: 20000,
      netEquity: 10000,
      marginEquity: 10000,
      maintenanceRequired: 6000,
      maintenanceExcess: 4000,
      maintenanceShortfall: 0,
    });
    expect(summarizeMargin(1000, 20000, 0, terms)).toEqual({
      debt: 10000,
      grossValue: 21000,
      netEquity: 11000,
      marginEquity: 11000,
      maintenanceRequired: 6000,
      maintenanceExcess: 5000,
      maintenanceShortfall: 0,
    });
  });

  it("includes long options in net equity while assigning them zero collateral", () => {
    expect(summarizeMargin(0, 20000, 5000, terms)).toEqual({
      debt: 10000,
      grossValue: 25000,
      netEquity: 15000,
      marginEquity: 10000,
      maintenanceRequired: 6000,
      maintenanceExcess: 4000,
      maintenanceShortfall: 0,
    });
    expect(summarizeMargin(0, 0, 20000, terms)).toEqual({
      debt: 10000,
      grossValue: 20000,
      netEquity: 10000,
      marginEquity: -10000,
      maintenanceRequired: 0,
      maintenanceExcess: -10000,
      maintenanceShortfall: 10000,
    });
  });

  it("keeps legitimate negative net equity and a maintenance shortfall visible", () => {
    expect(summarizeMargin(0, 12000, 0, terms)).toEqual({
      debt: 10000,
      grossValue: 12000,
      netEquity: 2000,
      marginEquity: 2000,
      maintenanceRequired: 3600,
      maintenanceExcess: -1600,
      maintenanceShortfall: 1600,
    });
    expect(summarizeMargin(100, 400, 200, { ...terms, debt: 1000 })).toEqual({
      debt: 1000,
      grossValue: 700,
      netEquity: -300,
      marginEquity: -500,
      maintenanceRequired: 120,
      maintenanceExcess: -620,
      maintenanceShortfall: 620,
    });
  });

  it("supports zero, cash-only and full-maintenance accounts without division", () => {
    expect(summarizeMargin(0, 0, 0)).toEqual(zeroSummary);
    expect(summarizeMargin(5000, 0, 0, { ...terms, debt: 2000 })).toEqual({
      debt: 2000,
      grossValue: 5000,
      netEquity: 3000,
      marginEquity: 3000,
      maintenanceRequired: 0,
      maintenanceExcess: 3000,
      maintenanceShortfall: 0,
    });
    expect(
      summarizeMargin(0, 20000, 0, { ...terms, maintenancePercent: 100 }),
    ).toEqual({
      debt: 10000,
      grossValue: 20000,
      netEquity: 10000,
      marginEquity: 10000,
      maintenanceRequired: 20000,
      maintenanceExcess: -10000,
      maintenanceShortfall: 10000,
    });
  });

  it("retains raw sub-cent and large finite legacy asset values", () => {
    const small = summarizeMargin(0.001, 0.002, 0.004)!;
    expect(small.grossValue).toBeCloseTo(0.007, 14);
    expect(small.maintenanceRequired).toBeCloseTo(0.0005, 14);
    expect(small.maintenanceExcess).toBeCloseTo(0.0025, 14);
    expect(summarizeMargin(1e20, 1e20, 1e20)).toEqual({
      debt: 0,
      grossValue: 3e20,
      netEquity: 3e20,
      marginEquity: 2e20,
      maintenanceRequired: 2.5e19,
      maintenanceExcess: 1.75e20,
      maintenanceShortfall: 0,
    });
  });

  it.each([NaN, Infinity, -Infinity, -1, null, "100"])(
    "returns unavailable for invalid asset total %s in every asset category",
    (value) => {
      const invalid = value as number;
      expect(summarizeMargin(invalid, 100, 100)).toBeNull();
      expect(summarizeMargin(100, invalid, 100)).toBeNull();
      expect(summarizeMargin(100, 100, invalid)).toBeNull();
    },
  );

  it("returns unavailable when finite assets overflow or explicit settings are null", () => {
    expect(summarizeMargin(Number.MAX_VALUE, Number.MAX_VALUE, 0)).toBeNull();
    expect(summarizeMargin(0, Number.MAX_VALUE, Number.MAX_VALUE)).toBeNull();
    expect(
      summarizeMargin(100, 100, 100, null as unknown as MarginSettings),
    ).toBeNull();
  });
});

describe("per-account margin aggregation", () => {
  it("sums every account field and preserves shortfalls despite aggregate surplus", () => {
    const healthy = summarizeMargin(0, 20000, 0, terms)!;
    const deficient = summarizeMargin(0, 12000, 0, terms)!;
    expect(aggregateMargin([healthy, deficient])).toEqual({
      debt: 20000,
      grossValue: 32000,
      netEquity: 12000,
      marginEquity: 12000,
      maintenanceRequired: 9600,
      maintenanceExcess: 2400,
      maintenanceShortfall: 1600,
    });
    expect(aggregateMargin([deficient, deficient])!.maintenanceShortfall).toBe(
      3200,
    );
    expect(aggregateMargin([])).toEqual(zeroSummary);
  });

  it("never drops an unavailable account or returns nonfinite totals", () => {
    const healthy = summarizeMargin(0, 20000, 0, terms)!;
    expect(aggregateMargin([healthy, null])).toBeNull();
    expect(aggregateMargin([null, healthy])).toBeNull();
    for (const field of Object.keys(healthy) as (keyof MarginSummary)[]) {
      expect(aggregateMargin([{ ...healthy, [field]: NaN }])).toBeNull();
      expect(aggregateMargin([{ ...healthy, [field]: Infinity }])).toBeNull();
      expect(
        aggregateMargin([
          { ...healthy, [field]: Number.MAX_VALUE },
          { ...healthy, [field]: Number.MAX_VALUE },
        ]),
      ).toBeNull();
    }
  });
});

describe("projected margin financing", () => {
  // Expected values were calculated independently with 65-digit Decimal math.
  it.each([
    [360, 30.439087548101816, 1030.4390875481018],
    [365, 30.016126409838675, 1030.0161264098387],
  ] as const)(
    "compounds daily on the entered principal using a %s-day basis",
    (dayCountBasis, interest, outstandingDebt) => {
      const result = projectMarginDebt(
        { ...terms, debt: 1000, aprPercent: 36, dayCountBasis },
        30,
      )!;
      expect(result.principal).toBe(1000);
      expect(result.elapsedDays).toBe(30);
      expect(result.interest).toBeCloseTo(interest, 11);
      expect(result.outstandingDebt).toBeCloseTo(outstandingDebt, 10);
      expect(result.interest).not.toBe(Math.round(result.interest * 100) / 100);
    },
  );

  it("uses actual monthly days and keeps principal separate from the financing expense", () => {
    const days = elapsedMarginDays(
      "2026-01-01T20:00:00Z",
      "2026-02-01T20:00:00Z",
    )!;
    const result = projectMarginDebt(terms, days)!;
    expect(days).toBe(31);
    expect(result.principal).toBe(10000);
    expect(result.interest).toBeCloseTo(103.85166870638505, 10);
    expect(result.outstandingDebt).toBeCloseTo(10103.851668706385, 9);
    expect(20000 - result.outstandingDebt).toBeCloseTo(9896.148331293615, 9);
    expect(20000 - result.outstandingDebt - (20000 - terms.debt)).toBeCloseTo(
      -103.85166870638505,
      9,
    );
    expect(
      projectMarginDebt({ ...terms, dayCountBasis: 365 }, days)!.interest,
    ).toBeCloseTo(102.42201760177036, 10);
  });

  it("retains very small interest accurately", () => {
    const small = projectMarginDebt(
      { ...terms, debt: 1e12, aprPercent: 1e-16 },
      1,
    )!;
    expect(small.interest).toBeGreaterThan(0);
    expect(small.interest).toBeCloseTo(2.7777777777777778e-9, 22);
  });

  it.each([
    ["2026-04-15T10:00:00-04:00", "2026-04-15T22:00:00-04:00", 0],
    ["2026-03-08T00:00:00-05:00", "2026-03-09T00:00:00-04:00", 1],
    ["2026-11-01T00:00:00-04:00", "2026-11-02T00:00:00-05:00", 1],
    ["2024-02-28T16:00:00-05:00", "2024-03-01T16:00:00-05:00", 2.001],
  ] as const)(
    "applies calendar-day financing from %s to %s",
    (captured, at, interest) => {
      const result = projectMarginDebt(
        { ...terms, debt: 1000, aprPercent: 36 },
        elapsedMarginDays(captured, at)!,
      )!;
      expect(result.interest).toBeCloseTo(interest, 12);
    },
  );

  it("short-circuits zero debt, APR or elapsed days before overflow calculations", () => {
    expect(
      projectMarginDebt(
        { ...terms, debt: 0, aprPercent: Number.MAX_VALUE },
        Number.MAX_SAFE_INTEGER,
      ),
    ).toEqual({
      principal: 0,
      interest: 0,
      outstandingDebt: 0,
      elapsedDays: Number.MAX_SAFE_INTEGER,
    });
    expect(
      projectMarginDebt({ ...terms, aprPercent: 0 }, Number.MAX_SAFE_INTEGER),
    ).toEqual({
      principal: 10000,
      interest: 0,
      outstandingDebt: 10000,
      elapsedDays: Number.MAX_SAFE_INTEGER,
    });
    expect(
      projectMarginDebt({ ...terms, aprPercent: Number.MAX_VALUE }, 0),
    ).toEqual({
      principal: 10000,
      interest: 0,
      outstandingDebt: 10000,
      elapsedDays: 0,
    });
  });

  it("honors a finite high APR without an arbitrary rate cap", () => {
    expect(
      projectMarginDebt({ ...terms, debt: 1000, aprPercent: 720 }, 1)!.interest,
    ).toBeCloseTo(20, 12);
  });

  it.each([
    -1,
    0.5,
    30.1,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MAX_VALUE,
    NaN,
    Infinity,
    -Infinity,
    null,
    "30",
  ])("refuses invalid elapsed days %s even at zero debt", (days) => {
    expect(projectMarginDebt(terms, days as number)).toBeNull();
    expect(projectMarginDebt(defaultMarginSettings, days as number)).toBeNull();
  });

  it("returns unavailable for exponent or principal-times-growth overflow", () => {
    expect(projectMarginDebt(terms, Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(
      projectMarginDebt({ ...terms, aprPercent: Number.MAX_VALUE }, 2),
    ).toBeNull();
    expect(
      projectMarginDebt({ ...terms, debt: 1e12, aprPercent: 36000 }, 1020),
    ).toBeNull();
  });
});

describe("elapsed margin time", () => {
  it.each([
    ["2024-02-28T20:00:00Z", "2024-03-01T20:00:00Z", 2],
    ["0000-02-29T20:00:00Z", "0000-03-01T20:00:00Z", 1],
    ["0099-12-31T20:00:00Z", "0100-01-01T20:00:00Z", 1],
    ["2025-02-28T20:00:00Z", "2025-03-01T20:00:00Z", 1],
    ["2024-01-01", "2025-01-01", 366],
    ["2026-01-31T20:00:00Z", "2026-02-28T20:00:00Z", 28],
    ["2026-04-15T10:00:00Z", "2026-04-15T22:00:00Z", 0],
    ["2026-04-15T18:00:00Z", "2026-04-30T20:00:00Z", 15],
    ["2026-03-08T00:00:00-05:00", "2026-03-09T00:00:00-04:00", 1],
    ["2026-11-01T00:00:00-04:00", "2026-11-02T00:00:00-05:00", 1],
    ["2026-04-15T23:30:00-04:00", "2026-04-16T00:30:00-04:00", 1],
    ["2026-04-15T23:30:00Z", "2026-04-16T00:30:00Z", 0],
    ["2026-05-01T20:00:00Z", "2026-05-04T20:00:00Z", 3],
    ["2026-10-05T12:00:00-04:00", "2026-10-05T16:00:00Z", 0],
    [0, "1970-01-02T00:00:00Z", 1],
    ["1969-12-31T00:00:00Z", 0, 1],
    [0.5, 1.5, 0],
  ] as const)(
    "counts Eastern calendar days from %s to %s",
    (captured, at, days) => {
      expect(elapsedMarginDays(captured, at)).toBe(days);
    },
  );

  it.each([
    "",
    "not a date",
    "2026-13-01T00:00:00Z",
    "2026-02-30T00:00:00Z",
    "2025-02-29",
    NaN,
    Infinity,
    -Infinity,
    8640000000000001,
    null,
    false,
  ])(
    "returns unavailable for invalid date input %s at either endpoint",
    (value) => {
      expect(
        elapsedMarginDays(value as string | number, "2026-10-05"),
      ).toBeNull();
      expect(
        elapsedMarginDays("2026-10-05", value as string | number),
      ).toBeNull();
    },
  );

  it("refuses backwards time instead of applying negative interest", () => {
    expect(
      elapsedMarginDays("2026-10-05T16:00:00Z", "2026-10-05T15:59:59Z"),
    ).toBeNull();
    expect(elapsedMarginDays(1000, 999)).toBeNull();
  });
});

it("never mutates caller-owned settings, asset totals or account summaries", () => {
  const source = Object.freeze({
    cash: 1000,
    equities: 20000,
    options: 5000,
    margin: Object.freeze({ ...terms }),
  });
  const before = structuredClone(source);
  const summaries = [
    Object.freeze(
      summarizeMargin(
        source.cash,
        source.equities,
        source.options,
        source.margin,
      )!,
    ),
  ];
  const summariesBefore = structuredClone(summaries);
  Object.freeze(summaries);
  aggregateMargin(summaries);
  projectMarginDebt(source.margin, 30);
  resolveMarginSettings(source.margin);
  expect(source).toEqual(before);
  expect(summaries).toEqual(summariesBefore);
});
