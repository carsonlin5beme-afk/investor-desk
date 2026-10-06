import { describe, expect, it } from "vitest";
import {
  capitalGainTerm,
  createTaxSettings,
  estimateFederalTax,
  federalTaxRules,
  isTaxDate,
  projectScenarioTax,
  scenarioTaxSettingsSchema,
  taxCalendarDate,
  taxFilingStatuses,
  type ScenarioTaxSettings,
  type TaxRuleYear,
} from "../../src/lib/scenario-tax";

const estimate = (
  shortTermGains: number,
  longTermGains = 0,
  otherOrdinaryIncome = 0,
) =>
  estimateFederalTax({
    rulesYear: 2026,
    filingStatus: "single",
    shortTermGains,
    longTermGains,
    otherOrdinaryIncome,
  })!;
const settings = (): ScenarioTaxSettings => ({
  rulesYear: 2026,
  filingStatus: "single",
  otherOrdinaryIncome: 0,
  assumptions: [
    {
      assetId: "stock",
      included: true,
      treatment: "standard",
      acquiredDate: "2025-01-01",
      totalBasis: 10000,
    },
  ],
});
const sale = {
  assetId: "stock",
  label: "Stock",
  proceeds: 70000,
  saleDate: "2026-01-02",
};

describe("Federal planning arithmetic against IRS table examples", () => {
  it("uses no other income by default, the standard deduction, and graduated short-term slices", () => {
    expect(estimate(60000)).toMatchObject({
      adjustedGrossIncome: 60000,
      taxableIncome: 43900,
      regularTax: 5020,
      niit: 0,
      taxReserve: 5020,
      afterTaxGain: 54980,
      ordinaryTopRate: 0.12,
    });
    expect(estimate(16100).taxReserve).toBe(0);
    expect(estimate(16101).taxReserve).toBe(0.1);
  });
  it.each([2025, 2026] as TaxRuleYear[])(
    "honors every published status deduction in %i",
    (rulesYear) => {
      for (const filingStatus of taxFilingStatuses) {
        const table = federalTaxRules[rulesYear][filingStatus];
        expect(
          estimateFederalTax({
            rulesYear,
            filingStatus,
            otherOrdinaryIncome: 0,
            shortTermGains: table.deduction,
            longTermGains: 0,
          })!.annualTax,
        ).toBe(0);
        expect(
          estimateFederalTax({
            rulesYear,
            filingStatus,
            otherOrdinaryIncome: 0,
            shortTermGains: table.deduction + 1,
            longTermGains: 0,
          })!.annualTax,
        ).toBe(0.1);
      }
    },
  );
  it("matches each 2026 Single ordinary bracket base rather than multiplying by the top rate", () => {
    const taxable = [12400, 50400, 105700, 201775, 256225, 640600];
    const bases = [1240, 5800, 17966, 41024, 58448, 192979.25];
    taxable.forEach((value, i) => {
      expect(estimate(value + 16100).regularTax).toBe(bases[i]);
      expect(estimate(value + 16101).regularTax).toBeCloseTo(
        bases[i] + [0.12, 0.22, 0.24, 0.32, 0.35, 0.37][i],
        2,
      );
    });
  });
  it("uses the actual 2025 joint second boundary, 96950", () => {
    const result = estimateFederalTax({
      rulesYear: 2025,
      filingStatus: "marriedJoint",
      otherOrdinaryIncome: 0,
      shortTermGains: 128450,
      longTermGains: 0,
    })!;
    expect(result.taxableIncome).toBe(96950);
    expect(result.regularTax).toBe(11157);
    expect(result.ordinaryTopRate).toBe(0.12);
  });
  it("makes long-term gain zero-rated through the deduction plus zero-rate ceiling", () => {
    expect(estimate(0, 60000).annualTax).toBe(0);
    expect(estimate(0, 65550).annualTax).toBe(0);
    expect(estimate(0, 65551).annualTax).toBe(0.15);
  });
  it("stacks long-term gain above taxable ordinary income and splits rate bands", () => {
    const result = estimate(56100, 20000);
    expect(result.taxableOrdinaryIncome).toBe(40000);
    expect(result.longTermBands).toEqual([
      { rate: 0, amount: 9450, tax: 0 },
      { rate: 0.15, amount: 10550, tax: 1582.5 },
    ]);
    expect(result.regularTax).toBe(6134.5);
  });
  it("applies the 20% tier and NIIT separately at a high-gain target", () => {
    expect(estimate(0, 600000)).toMatchObject({
      regularTax: 82087.5,
      niit: 15200,
      annualTax: 97287.5,
      longTermTopRate: 0.2,
    });
  });
  it("nets losses without falsely giving remaining short-term gain a preferred rate", () => {
    expect(estimate(30000, -10000)).toMatchObject({
      netCapitalGain: 20000,
      taxableLongTermGains: 0,
      regularTax: 390,
    });
    expect(estimate(-10000, 30000)).toMatchObject({
      netCapitalGain: 20000,
      taxableLongTermGains: 3900,
      regularTax: 0,
    });
    expect(estimate(-5000, 5000).annualTax).toBe(0);
  });
  it("caps the modeled ordinary loss deduction, without fabricating a carryforward or refund", () => {
    expect(estimate(-10000)).toMatchObject({
      capitalLossDeduction: 3000,
      adjustedGrossIncome: -3000,
      annualTax: 0,
      taxReserve: 0,
      modeledTaxReduction: 0,
      afterTaxGain: -10000,
    });
    expect(estimate(-10000, 0, 50000)).toMatchObject({
      annualTax: 3460,
      baselineTax: 3820,
      taxChange: -360,
      taxReserve: 0,
      modeledTaxReduction: 360,
      afterTaxGain: -10000,
    });
    expect(
      estimateFederalTax({
        rulesYear: 2026,
        filingStatus: "marriedSeparate",
        otherOrdinaryIncome: 50000,
        shortTermGains: -10000,
        longTermGains: 0,
      })!.capitalLossDeduction,
    ).toBe(1500);
  });
  it("uses AGI before standard deduction for the NIIT threshold", () => {
    expect(estimate(0, 200000).niit).toBe(0);
    expect(estimate(0, 200100).niit).toBe(3.8);
    expect(estimate(100000, 150000)).toMatchObject({
      regularTax: 35670,
      niit: 1900,
      annualTax: 37570,
    });
  });
  it.each(taxFilingStatuses)(
    "limits NIIT to modeled investment income for %s",
    (filingStatus) => {
      const threshold = federalTaxRules[2026][filingStatus].niitThreshold;
      const result = estimateFederalTax({
        rulesYear: 2026,
        filingStatus,
        otherOrdinaryIncome: threshold + 10000,
        shortTermGains: 1000,
        longTermGains: 0,
      })!;
      expect(result.niit).toBe(38);
    },
  );
  it("reserves only tax attributable to the planned sale, not unrelated salary taxes", () => {
    const result = estimate(10000, 0, 50000);
    expect(result.baselineTax).toBe(3820);
    expect(result.annualTax).toBe(5020);
    expect(result.taxReserve).toBe(1200);
  });
  it.each([NaN, Infinity, -Infinity, 1e20])(
    "rejects unsafe gain %s",
    (value) => {
      expect(estimate(value)).toBeNull();
      expect(estimate(0, value)).toBeNull();
    },
  );
  it.each([-1, NaN, Infinity, 1e13, 1.005, 1e-8, Number.MIN_VALUE])(
    "rejects invalid annual income %s",
    (value) => expect(estimate(0, 0, value)).toBeNull(),
  );
});

describe("Actual dates and holding period", () => {
  it.each([
    "2026-02-29",
    "2026-02-30",
    "2026-04-31",
    "2026-13-01",
    "26-01-01",
    "",
    "not-a-date",
  ])("rejects impossible date %s", (value) => {
    expect(isTaxDate(value)).toBe(false);
    expect(capitalGainTerm(value, "2026-12-31")).toBeNull();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
      expect(taxCalendarDate(value)).toBeNull();
  });
  it("keeps the anniversary short-term and the next day long-term", () => {
    expect(capitalGainTerm("2025-10-05", "2026-10-05")).toBe("short");
    expect(capitalGainTerm("2025-10-05", "2026-10-06")).toBe("long");
    expect(capitalGainTerm("2026-10-05", "2026-10-05")).toBe("short");
    expect(capitalGainTerm("2026-10-06", "2026-10-05")).toBeNull();
  });
  it("uses calendar anniversaries instead of a fixed 365-day shortcut across leap years", () => {
    expect(capitalGainTerm("2023-03-01", "2024-03-01")).toBe("short");
    expect(capitalGainTerm("2023-03-01", "2024-03-02")).toBe("long");
    // Derived from the IRS more-than-one-year rule, not a quoted IRS leap example.
    expect(capitalGainTerm("2024-02-29", "2025-02-28")).toBe("short");
    expect(capitalGainTerm("2024-02-29", "2025-03-01")).toBe("long");
  });
  it("converts instants to Eastern trade dates, retaining already dated checkpoints", () => {
    expect(taxCalendarDate("2027-01-01T02:00:00Z")).toBe("2026-12-31");
    expect(taxCalendarDate("2026-03-08T06:00:00Z")).toBe("2026-03-08");
    expect(taxCalendarDate("2027-01-01")).toBe("2027-01-01");
    expect(taxCalendarDate(NaN)).toBeNull();
    expect(taxCalendarDate("2026-02-30T20:00:00Z")).toBeNull();
    expect(taxCalendarDate("2026-02-29T20:00:00-05:00")).toBeNull();
    expect(taxCalendarDate("2026-01-01T12:00")).toBeNull();
  });
});

describe("Scenario liquidation, completeness, and saved assumptions", () => {
  it("starts with zero other income and an unknown acquired date, retaining editable captured basis", () => {
    expect(createTaxSettings([{ id: "stock", costBasis: 10000 }])).toEqual({
      rulesYear: 2026,
      filingStatus: "single",
      otherOrdinaryIncome: 0,
      assumptions: [
        {
          assetId: "stock",
          included: true,
          treatment: "unknown",
          acquiredDate: null,
          totalBasis: 10000,
        },
      ],
    });
    expect(
      projectScenarioTax(
        createTaxSettings([{ id: "stock", costBasis: 10000 }]),
        [sale],
      ).complete,
    ).toBe(false);
  });
  it("computes gain from gross proceeds and basis, with no debt or cash adjustment", () => {
    const result = projectScenarioTax(settings(), [sale]);
    expect(result).toMatchObject({
      complete: true,
      proceeds: 70000,
      gain: 60000,
      taxReserve: 0,
      afterTaxGain: 60000,
    });
    expect(result.rows[0].term).toBe("long");
    const changed = settings();
    changed.assumptions[0].acquiredDate = "2025-01-02";
    expect(projectScenarioTax(changed, [sale]).taxReserve).toBe(5020);
  });
  it("treats zero proceeds and zero basis as values, not missing input", () => {
    const config = settings();
    config.assumptions[0].totalBasis = 0;
    expect(
      projectScenarioTax(config, [{ ...sale, proceeds: 0 }]),
    ).toMatchObject({ complete: true, gain: 0, taxReserve: 0 });
    config.assumptions[0].totalBasis = 10000;
    expect(
      projectScenarioTax(config, [{ ...sale, proceeds: 0 }]),
    ).toMatchObject({ complete: true, gain: -10000, taxReserve: 0 });
  });
  it("groups actual realization years independently, applying one annual deduction per year", () => {
    const config = settings();
    config.assumptions[0].acquiredDate = "2026-01-01";
    config.assumptions.push({
      assetId: "option",
      included: true,
      treatment: "standard",
      acquiredDate: "2025-12-31",
      totalBasis: 0,
    });
    const result = projectScenarioTax(config, [
      { ...sale, proceeds: 30000, saleDate: "2027-01-01" },
      {
        assetId: "option",
        label: "Option expiry proxy",
        proceeds: 20000,
        saleDate: "2026-12-31",
      },
    ]);
    expect(result.complete).toBe(true);
    expect(
      result.years.map((y) => [y.saleYear, y.taxReserve, y.usesAssumedRules]),
    ).toEqual([
      [2026, 390, false],
      [2027, 390, true],
    ]);
    expect(result.taxReserve).toBe(780);
    expect(result.gain).toBe(40000);
  });
  it.each(["date", "basis", "income", "proceeds"])(
    "does not show partial tax totals with blank %s",
    (field) => {
      const config = settings();
      const row = { ...sale };
      if (field === "date") config.assumptions[0].acquiredDate = null;
      if (field === "basis") config.assumptions[0].totalBasis = null;
      if (field === "income") config.otherOrdinaryIncome = null;
      if (field === "proceeds") row.proceeds = null as unknown as number;
      const result = projectScenarioTax(config, [row]);
      expect(result.complete).toBe(false);
      expect(result.taxReserve).toBeNull();
      expect(result.years).toEqual([]);
    },
  );
  it("allows explicitly excluded holdings without assuming they were sold", () => {
    const config = settings();
    config.assumptions[0] = {
      assetId: "stock",
      included: false,
      treatment: "unsupported",
      acquiredDate: null,
      totalBasis: null,
    };
    expect(
      projectScenarioTax(config, [{ ...sale, proceeds: null, saleDate: null }]),
    ).toMatchObject({ complete: true, gain: 0, taxReserve: 0, proceeds: 0 });
  });
  it("rejects duplicate or unmatched holdings rather than double-counting tax", () => {
    expect(projectScenarioTax(settings(), [sale, sale]).complete).toBe(false);
    const config = settings();
    config.assumptions.push({ ...config.assumptions[0] });
    expect(scenarioTaxSettingsSchema.safeParse(config).success).toBe(false);
    expect(
      projectScenarioTax(settings(), [{ ...sale, assetId: "foreign" }])
        .complete,
    ).toBe(false);
    expect(projectScenarioTax(settings(), []).complete).toBe(false);
  });
  it.each(["unknown", "unsupported"] as const)(
    "keeps %s tax treatment unavailable until explicitly included in the supported model",
    (treatment) => {
      const config = settings();
      config.assumptions[0].treatment = treatment;
      const result = projectScenarioTax(config, [sale]);
      expect(result.complete).toBe(false);
      expect(result.taxReserve).toBeNull();
      expect(result.rows[0].issue).toMatch(/treatment/);
      expect(result.rows[0].term).toBeNull();
    },
  );
  it("shows invalid acquisition ordering, unavailable model reasons and unsafe proceeds explicitly", () => {
    const config = settings();
    config.assumptions[0].acquiredDate = "2026-01-03";
    expect(projectScenarioTax(config, [sale]).rows[0].issue).toMatch(
      /on or before/,
    );
    expect(
      projectScenarioTax(settings(), [
        { ...sale, reason: "Missing underlying price" },
      ]).rows[0].issue,
    ).toBe("Missing underlying price");
    expect(
      projectScenarioTax(settings(), [{ ...sale, proceeds: 1e20 }]).taxReserve,
    ).toBeNull();
  });
  it("preserves assumptions through JSON round-trip without mutating captured holdings", () => {
    const assets = [{ id: "stock", costBasis: 10000 }],
      config = createTaxSettings(assets);
    config.assumptions[0].acquiredDate = "2024-01-01";
    config.assumptions[0].totalBasis = 12000;
    const restored = scenarioTaxSettingsSchema.parse(
      JSON.parse(JSON.stringify(config)),
    );
    expect(restored).toEqual(config);
    expect(assets[0].costBasis).toBe(10000);
  });
});
