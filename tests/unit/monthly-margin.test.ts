import { describe, expect, it } from "vitest";
import { projectMonthly } from "@/lib/monthly-projection";
import { createMonthlyPlan } from "@/lib/monthly-scenario";
import { defaultMarginSettings, type MarginSettings } from "@/lib/margin";
import type { SavedScenario } from "@/lib/studio";
import { monthlyFixture } from "../fixtures/monthly-scenario";

const loan: MarginSettings = {
  debt: 10000,
  aprPercent: 12,
  maintenancePercent: 30,
  dayCountBasis: 360,
};

function flatEquityScenario(
  capturedAt = "2026-10-01T20:00:00.000Z",
  date = "2026-10-31",
): SavedScenario {
  const scenario = monthlyFixture();
  scenario.capturedAt = capturedAt;
  scenario.cash = 0;
  scenario.assets = [
    {
      ...scenario.assets[0],
      quantity: 2000,
      currentValue: 20000,
      costBasis: 20000,
      spot: 10,
      target: 10,
    },
  ];
  scenario.monthly = createMonthlyPlan(scenario.assets, capturedAt, 1);
  scenario.monthly.dates = [date];
  scenario.monthly.paths[0].prices = [10];
  scenario.portfolioNames = ["First account"];
  scenario.portfolioSnapshots = [
    {
      id: scenario.assets[0].portfolioId,
      name: "First account",
      cash: 0,
      margin: { ...loan },
    },
  ];
  return scenario;
}

function deepFreeze<T>(value: T): T {
  if (value != null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe("monthly frozen financing", () => {
  // These cent-rounded oracles use independent 65-digit Decimal arithmetic.
  it.each([
    [360, 100.48, 9899.52, 3899.52],
    [365, 99.1, 9900.9, 3900.9],
  ] as const)(
    "compounds 30 calendar days on a %s-day basis and deducts principal and interest once",
    (dayCountBasis, interest, netEquity, maintenanceExcess) => {
      const scenario = flatEquityScenario();
      scenario.portfolioSnapshots![0].margin.dayCountBasis = dayCountBasis;
      const row = projectMonthly(scenario)[0];
      expect(row).toMatchObject({
        date: "2026-10-31",
        at: "2026-10-31T20:00:00.000Z",
        cash: 0,
        equities: 20000,
        options: 0,
        grossTotal: 20000,
        principal: 10000,
        interest,
        outstandingDebt: 10000 + interest,
        netEquity,
        total: netEquity,
        knownSubtotal: 20000,
        profit: -interest,
        change: -interest,
        missingCount: 0,
        unavailableReason: null,
      });
      expect(row.changePercent).toBeCloseTo((-interest / 10000) * 100, 12);
      expect(row.costReturnPercent).toBeCloseTo((-interest / 20000) * 100, 12);
      expect(row.marginSummary).toEqual({
        debt: 10000 + interest,
        grossValue: 20000,
        netEquity,
        marginEquity: netEquity,
        maintenanceRequired: 6000,
        maintenanceExcess,
        maintenanceShortfall: 0,
      });
      expect(row.portfolioMargins).toEqual([
        {
          id: "fixture-portfolio",
          name: "First account",
          cash: 0,
          principal: 10000,
          interest,
          outstandingDebt: 10000 + interest,
          marginSummary: row.marginSummary,
        },
      ]);
      expect(row.positions[0].portfolioId).toBe("fixture-portfolio");
      expect(row.positions[0].profit).toBe(0);
    },
  );

  it.each([
    ["2026-03-01T21:00:00.000Z", "2026-03-31", 30.44],
    ["2026-11-01T00:00:00-04:00", "2026-11-30", 29.41],
    ["2028-01-31T21:00:00.000Z", "2028-02-29", 29.41],
    ["2026-10-30T20:00:00.000Z", "2026-10-31", 1],
    ["2026-10-31T13:00:00.000Z", "2026-10-31", 0],
    ["2026-10-15T18:00:00.000Z", "2026-10-31", 16.12],
    ["2026-10-02T01:00:00.000Z", "2026-10-31", 30.44],
  ] as const)(
    "uses Eastern dates, weekends, partial months and DST from %s to %s",
    (capturedAt, date, interest) => {
      const scenario = flatEquityScenario(capturedAt, date);
      scenario.portfolioSnapshots![0].margin = {
        ...loan,
        debt: 1000,
        aprPercent: 36,
      };
      const row = projectMonthly(scenario)[0];
      expect(row.interest).toBe(interest);
      expect(row.outstandingDebt).toBe(1000 + interest);
      expect(row.change).toBe(interest === 0 ? 0 : -interest);
    },
  );

  it("uses cumulative capture-to-checkpoint interest rather than subtracting earlier months again", () => {
    const scenario = flatEquityScenario();
    scenario.monthly!.dates = ["2026-10-31", "2026-11-30"];
    scenario.monthly!.paths[0].prices = [10, 10];
    const rows = projectMonthly(scenario);
    expect(rows[0].interest).toBe(100.48);
    // 60 days, not the sum of day-30 and day-60 interest or a fixed 30-day loan.
    expect(rows[1].interest).toBe(201.98);
    expect(rows[1].profit).toBe(-201.98);
    expect(rows[1].change).toBe(-201.98);
    expect(rows[1].netEquity).toBe(9798.02);
  });

  it("preserves investment profit and treats only new interest as an expense", () => {
    const scenario = flatEquityScenario();
    scenario.assets[0].costBasis = 15000;
    const financed = projectMonthly(scenario)[0];
    expect(financed.profit).toBe(4899.52);
    expect(financed.change).toBe(-100.48);
    expect(financed.positions[0].profit).toBe(5000);
    scenario.portfolioSnapshots![0].margin.aprPercent = 0;
    const zeroApr = projectMonthly(scenario)[0];
    expect(zeroApr).toMatchObject({
      principal: 10000,
      interest: 0,
      outstandingDebt: 10000,
      grossTotal: 20000,
      total: 10000,
      profit: 5000,
      change: 0,
    });
  });

  it.each([20000, 25000])(
    "keeps negative equity honest and withholds return ratios for a nonpositive net baseline of debt %s",
    (debt) => {
      const scenario = flatEquityScenario();
      scenario.portfolioSnapshots![0].margin = { ...loan, debt, aprPercent: 0 };
      const row = projectMonthly(scenario)[0];
      expect(row.total).toBe(20000 - debt);
      expect(row.netEquity).toBe(20000 - debt);
      expect(row.change).toBe(0);
      expect(row.changePercent).toBeNull();
      expect(row.marginSummary!.maintenanceShortfall).toBe(debt - 14000);
    },
  );

  it("withholds a cost-return ratio when holdings cost is zero while retaining known profit", () => {
    const scenario = flatEquityScenario();
    scenario.assets[0].costBasis = 0;
    const row = projectMonthly(scenario)[0];
    expect(row.profit).toBe(19899.52);
    expect(row.costReturnPercent).toBeNull();
    expect(row.changePercent).toBeCloseTo(-1.0048, 12);
  });
});

describe("monthly account separation and expiry collateral", () => {
  it("rounds cumulative interest once per account before aggregating pennies", () => {
    const scenario = flatEquityScenario("2026-10-30T20:00:00.000Z");
    scenario.assets.push({
      ...scenario.assets[0],
      id: "second-stock",
      portfolioId: "second",
    });
    scenario.portfolioSnapshots![0].margin = {
      ...loan,
      debt: 1,
      aprPercent: 120,
    };
    scenario.portfolioSnapshots!.push({
      id: "second",
      name: "Second",
      cash: 0,
      margin: { ...loan, debt: 1, aprPercent: 120 },
    });
    scenario.portfolioNames.push("Second");
    const row = projectMonthly(scenario)[0];
    // Each $1 liability accrues $0.003333..., individually rounded to $0.00.
    expect(row.portfolioMargins.map((account) => account.interest)).toEqual([
      0, 0,
    ]);
    expect(row).toMatchObject({
      interest: 0,
      principal: 2,
      outstandingDebt: 2,
      grossTotal: 40000,
      netEquity: 39998,
      change: 0,
      profit: 0,
    });
  });

  it("uses frozen account rates/bases and sums shortfalls without cross-account netting", () => {
    const scenario = flatEquityScenario();
    scenario.assets.push({
      ...scenario.assets[0],
      id: "second-stock",
      portfolioId: "second-portfolio",
      quantity: 1200,
      currentValue: 12000,
      costBasis: 12000,
    });
    const liveTerms = { ...loan, aprPercent: 36 };
    scenario.portfolioSnapshots![0].margin = structuredClone(liveTerms);
    scenario.portfolioSnapshots!.push({
      id: "second-portfolio",
      name: "Second account",
      cash: 0,
      margin: { ...loan, dayCountBasis: 365 },
    });
    scenario.portfolioNames.push("Second account");
    liveTerms.aprPercent = 999;
    const before = structuredClone(scenario);
    deepFreeze(scenario);
    const row = projectMonthly(scenario)[0];
    expect(row).toMatchObject({
      grossTotal: 32000,
      principal: 20000,
      interest: 403.49,
      outstandingDebt: 20403.49,
      netEquity: 11596.51,
      change: -403.49,
      profit: -403.49,
    });
    expect(row.portfolioMargins.map((account) => account.interest)).toEqual([
      304.39, 99.1,
    ]);
    expect(row.marginSummary).toEqual({
      debt: 20403.49,
      grossValue: 32000,
      netEquity: 11596.51,
      marginEquity: 11596.51,
      maintenanceRequired: 9600,
      maintenanceExcess: 1996.51,
      maintenanceShortfall: 1699.1,
    });
    expect(row.portfolioMargins[1].marginSummary!.maintenanceExcess).toBe(
      -1699.1,
    );
    expect(scenario).toEqual(before);
  });

  it("excludes held long options from collateral then credits their own expiry proceeds once", () => {
    const scenario = monthlyFixture();
    scenario.cash = 100;
    scenario.assets[1].quantity = 1;
    scenario.assets[1].currentValue = 100;
    scenario.assets[1].costBasis = 100;
    scenario.monthly!.paths[0].prices = [8, 8, 8, 50];
    scenario.portfolioSnapshots = [
      {
        id: "fixture-portfolio",
        name: "Options",
        cash: 100,
        margin: { ...loan, debt: 500, aprPercent: 0 },
      },
    ];
    const before = structuredClone(scenario);
    const rows = projectMonthly(scenario);
    expect(rows[0].options).toBeGreaterThan(0);
    expect(rows[0].portfolioMargins[0].cash).toBe(100);
    expect(rows[0].marginSummary).toMatchObject({
      marginEquity: 400,
      maintenanceRequired: 240,
      maintenanceExcess: 160,
    });
    expect(rows[0].netEquity).toBeGreaterThan(
      rows[0].marginSummary!.marginEquity,
    );
    for (const row of rows.slice(2)) {
      expect(row.cash).toBe(100);
      expect(row.expiryProceeds).toBe(300);
      expect(row.options).toBe(0);
      expect(row.portfolioMargins[0].cash).toBe(400);
      expect(row.positions[1]).toMatchObject({
        portfolioId: "fixture-portfolio",
        state: "liquidated",
        expiryProceeds: 300,
        holdingValue: 0,
      });
    }
    expect(rows[2]).toMatchObject({
      grossTotal: 1200,
      netEquity: 700,
      profit: 600,
      change: 500,
    });
    expect(rows[2].marginSummary).toMatchObject({
      marginEquity: 700,
      maintenanceRequired: 240,
      maintenanceExcess: 460,
    });
    expect(rows[3]).toMatchObject({
      grossTotal: 5400,
      netEquity: 4900,
      profit: 4800,
      change: 4700,
    });
    expect(scenario).toEqual(before);
  });

  it("assigns option expiry proceeds to the owning account without curing another option-only shortfall", () => {
    const scenario = monthlyFixture();
    scenario.assets = [scenario.assets[1]];
    scenario.assets[0].quantity = 1;
    scenario.assets[0].currentValue = 100;
    scenario.assets[0].costBasis = 100;
    scenario.assets[0].option!.expiration = "2026-10-16T20:00:00.000Z";
    scenario.assets.push({
      ...structuredClone(scenario.assets[0]),
      id: "second-call",
      portfolioId: "second-portfolio",
      option: {
        ...scenario.assets[0].option!,
        expiration: "2026-12-18T21:00:00.000Z",
      },
    });
    scenario.cash = 300;
    scenario.portfolioNames = ["First option", "Second option"];
    scenario.portfolioSnapshots = [
      {
        id: "fixture-portfolio",
        name: "First option",
        cash: 100,
        margin: { ...loan, debt: 100, aprPercent: 0 },
      },
      {
        id: "second-portfolio",
        name: "Second option",
        cash: 200,
        margin: { ...loan, debt: 500, aprPercent: 0 },
      },
    ];
    scenario.monthly!.paths[0].prices = [8, 8, 8, 8];
    scenario.monthly!.expiryPrices = [
      { symbol: "BTG", date: "2026-10-16", price: 8 },
    ];
    const row = projectMonthly(scenario)[0];
    expect(row.expiryProceeds).toBe(300);
    expect(row.portfolioMargins.map((account) => account.cash)).toEqual([
      400, 200,
    ]);
    expect(
      row.portfolioMargins.map(
        (account) => account.marginSummary!.marginEquity,
      ),
    ).toEqual([300, -300]);
    expect(row.marginSummary).toMatchObject({
      marginEquity: 0,
      maintenanceRequired: 0,
      maintenanceExcess: 0,
      maintenanceShortfall: 300,
    });
    expect(row.positions[0].state).toBe("liquidated");
    expect(row.positions[1].state).toBe("model");
  });
});

describe("legacy and incomplete monthly margin states", () => {
  it("keeps frozen financing known when an option model overflows independently", () => {
    const scenario = monthlyFixture();
    scenario.portfolioSnapshots = [
      {
        id: "fixture-portfolio",
        name: "Options",
        cash: 1000,
        margin: { ...loan },
      },
    ];
    const reference = projectMonthly(scenario)[0];
    scenario.assets[1].option!.expiration = "9999-12-17T21:00:00.000Z";
    scenario.monthly!.rate = -0.1;
    const row = projectMonthly(scenario)[0];
    expect(row).toMatchObject({
      grossTotal: null,
      total: null,
      profit: null,
      marginSummary: null,
      knownSubtotal: 1600,
      missingCount: 1,
    });
    expect(row.interest).toBe(reference.interest);
    expect(row.outstandingDebt).toBe(reference.outstandingDebt);
    expect(row.portfolioMargins[0].cash).toBe(1000);
    expect(row.positions[1].reason).toContain("supported model range");
  });

  it("preserves known financing when captured account cash exceeds monthly safe cents", () => {
    const scenario = flatEquityScenario();
    scenario.cash = 1e20;
    scenario.portfolioSnapshots![0].cash = 1e20;
    const row = projectMonthly(scenario)[0];
    expect(row).toMatchObject({
      cash: null,
      grossTotal: null,
      total: null,
      interest: 100.48,
      outstandingDebt: 10100.48,
      knownSubtotal: 20000,
      marginSummary: null,
    });
    expect(row.portfolioMargins[0]).toMatchObject({
      cash: null,
      interest: 100.48,
      marginSummary: null,
    });
    expect(row.unavailableReason).toContain("Starting cash");
  });

  it("keeps old snapshots debt-free without fabricating account cash allocations", () => {
    const scenario = flatEquityScenario();
    delete scenario.portfolioSnapshots;
    const row = projectMonthly(scenario)[0];
    expect(row).toMatchObject({
      grossTotal: 20000,
      netEquity: 20000,
      total: 20000,
      principal: 0,
      interest: 0,
      outstandingDebt: 0,
      portfolioMargins: [],
      profit: 0,
      change: 0,
    });
    expect(row.marginSummary).toEqual({
      debt: 0,
      grossValue: 20000,
      netEquity: 20000,
      marginEquity: 20000,
      maintenanceRequired: 5000,
      maintenanceExcess: 15000,
      maintenanceShortfall: 0,
    });
  });

  it("keeps independently known financing and captured cash when a stock target is missing", () => {
    const scenario = flatEquityScenario();
    scenario.cash = 1000;
    scenario.portfolioSnapshots![0].cash = 1000;
    scenario.monthly!.paths[0].prices = [null];
    const row = projectMonthly(scenario)[0];
    expect(row).toMatchObject({
      grossTotal: null,
      netEquity: null,
      total: null,
      profit: null,
      change: null,
      marginSummary: null,
      principal: 10000,
      interest: 100.48,
      outstandingDebt: 10100.48,
      knownSubtotal: 1000,
      missingCount: 1,
    });
    expect(row.portfolioMargins[0]).toMatchObject({
      cash: 1000,
      interest: 100.48,
      marginSummary: null,
    });
    delete scenario.portfolioSnapshots;
    expect(projectMonthly(scenario)[0]).toMatchObject({
      knownSubtotal: 1000,
      interest: 0,
      outstandingDebt: 0,
      total: null,
      marginSummary: null,
    });
  });

  it("retains a healthy account's known result while another account's target is incomplete", () => {
    const scenario = flatEquityScenario();
    scenario.assets.push({
      ...scenario.assets[0],
      id: "other-equity",
      portfolioId: "other",
      symbol: "PL",
    });
    scenario.portfolioSnapshots!.push({
      id: "other",
      name: "Other",
      cash: 0,
      margin: { ...loan, aprPercent: 0 },
    });
    scenario.portfolioNames.push("Other");
    scenario.monthly = createMonthlyPlan(
      scenario.assets,
      scenario.capturedAt,
      1,
    );
    scenario.monthly.dates = ["2026-10-31"];
    scenario.monthly.paths.forEach((path) => {
      path.prices = [path.symbol === "BTG" ? 10 : null];
    });
    const row = projectMonthly(scenario)[0];
    expect(row).toMatchObject({
      total: null,
      interest: 100.48,
      knownSubtotal: 20000,
      marginSummary: null,
      missingCount: 1,
    });
    expect(row.portfolioMargins[0].marginSummary!.netEquity).toBe(9899.52);
    expect(row.portfolioMargins[1].marginSummary).toBeNull();
  });

  it("allows finite projected liabilities above the persisted principal entry cap", () => {
    const scenario = flatEquityScenario();
    scenario.assets[0].quantity = 2e11;
    scenario.assets[0].currentValue = 2e12;
    scenario.assets[0].costBasis = 2e12;
    scenario.portfolioSnapshots![0].margin = {
      ...loan,
      debt: 1e12,
      aprPercent: 36,
    };
    const row = projectMonthly(scenario)[0];
    expect(row).toMatchObject({
      grossTotal: 2e12,
      principal: 1e12,
      interest: 30439087548.1,
      outstandingDebt: 1030439087548.1,
      netEquity: 969560912451.9,
    });
    expect(row.marginSummary).toMatchObject({
      debt: 1030439087548.1,
      netEquity: 969560912451.9,
      maintenanceRequired: 6e11,
      maintenanceExcess: 369560912451.9,
      maintenanceShortfall: 0,
    });
  });

  it.each([
    ["2026-10-01T20:00:00.000Z", Number.MAX_VALUE, 10000],
    ["2026-10-24T20:00:00.000Z", 36000, 1e12],
  ] as const)(
    "withholds overflowed financing from capture %s without hiding known principal or gross assets",
    (capturedAt, aprPercent, debt) => {
      const scenario = flatEquityScenario(capturedAt);
      scenario.portfolioSnapshots![0].margin = { ...loan, debt, aprPercent };
      const row = projectMonthly(scenario)[0];
      expect(row).toMatchObject({
        grossTotal: 20000,
        knownSubtotal: 20000,
        principal: debt,
        interest: null,
        outstandingDebt: null,
        netEquity: null,
        total: null,
        profit: null,
        change: null,
        marginSummary: null,
      });
      expect(row.unavailableReason).toContain("Financing");
      expect(row.portfolioMargins[0]).toMatchObject({
        principal: debt,
        interest: null,
        outstandingDebt: null,
        marginSummary: null,
      });
    },
  );

  it("refuses aggregate financing beyond safe cents while preserving individually known accounts", () => {
    const scenario = flatEquityScenario();
    scenario.assets = [];
    scenario.monthly!.paths = [];
    scenario.portfolioSnapshots = Array.from({ length: 100 }, (_, index) => ({
      id: `account-${index}`,
      name: `Account ${index}`,
      cash: 0,
      margin: { ...loan, debt: 1e12, aprPercent: 0 },
    }));
    scenario.portfolioNames = scenario.portfolioSnapshots.map(
      (account) => account.name,
    );
    const row = projectMonthly(scenario)[0];
    expect(row).toMatchObject({
      grossTotal: 0,
      knownSubtotal: 0,
      principal: null,
      interest: 0,
      outstandingDebt: null,
      netEquity: null,
      marginSummary: null,
    });
    expect(row.portfolioMargins).toHaveLength(100);
    expect(row.portfolioMargins[0]).toMatchObject({
      principal: 1e12,
      interest: 0,
      outstandingDebt: 1e12,
    });
  });

  it("makes normalized invalid capture dates unavailable instead of inventing a loan horizon", () => {
    const scenario = flatEquityScenario(
      "2026-02-30T12:00:00.000Z",
      "2026-03-31",
    );
    const row = projectMonthly(scenario)[0];
    expect(row).toMatchObject({
      grossTotal: 20000,
      principal: 10000,
      interest: null,
      outstandingDebt: null,
      total: null,
      marginSummary: null,
    });
    expect(row.unavailableReason).toContain("dates");
  });

  it("validates frozen account membership, cash and explicit settings before projecting", () => {
    const unknown = flatEquityScenario();
    unknown.assets[0].portfolioId = "not-captured";
    expect(() => projectMonthly(unknown)).toThrow("scope");
    const duplicate = flatEquityScenario();
    duplicate.portfolioSnapshots!.push(
      structuredClone(duplicate.portfolioSnapshots![0]),
    );
    expect(() => projectMonthly(duplicate)).toThrow("unique");
    const mismatchedCash = flatEquityScenario();
    mismatchedCash.portfolioSnapshots![0].cash = 0.01;
    expect(() => projectMonthly(mismatchedCash)).toThrow("cash");
    const malformed = flatEquityScenario();
    malformed.portfolioSnapshots![0].margin.aprPercent = -1;
    expect(() => projectMonthly(malformed)).toThrow();
  });

  it("preserves valid empty captured and legacy portfolios", () => {
    const scenario = flatEquityScenario();
    scenario.assets = [];
    scenario.monthly!.paths = [];
    scenario.portfolioSnapshots = [];
    scenario.portfolioNames = [];
    const row = projectMonthly(scenario)[0];
    expect(row).toMatchObject({
      total: 0,
      grossTotal: 0,
      interest: 0,
      principal: 0,
      marginSummary: { debt: 0, grossValue: 0, maintenanceShortfall: 0 },
    });
    expect(row.changePercent).toBeNull();
    expect(row.costReturnPercent).toBeNull();
    delete scenario.portfolioSnapshots;
    expect(projectMonthly(scenario)[0].marginSummary).toEqual(
      row.marginSummary,
    );
    expect(defaultMarginSettings.debt).toBe(0);
  });
});
