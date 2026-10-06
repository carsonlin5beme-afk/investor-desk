import { describe, expect, it } from "vitest";
import {
  monthlyTaxSales,
  targetTaxSales,
  targetDaysForSaleDate,
  targetSaleAt,
  targetSaleDate,
} from "@/lib/scenario-tax-sales";
import { createTaxSettings, projectScenarioTax } from "@/lib/scenario-tax";
import { projectMonthly } from "@/lib/monthly-projection";
import { scenarioFinancing, valueAt } from "@/lib/studio";
import { monthlyFixture } from "../fixtures/monthly-scenario";

describe("Scenario liquidation adapters", () => {
  it("uses gross holding values once, carrying original expiry date and proceeds into later checkpoints", () => {
    const s = monthlyFixture(),
      before = structuredClone(s),
      rows = projectMonthly(s);
    const dec = monthlyTaxSales(s, rows[2]),
      jan = monthlyTaxSales(s, rows[3]);
    expect(dec[0]).toMatchObject({ saleDate: "2026-12-31", proceeds: 900 });
    expect(jan[0]).toMatchObject({ saleDate: "2027-01-31", proceeds: 1500 });
    expect(dec[1].saleDate).toBe("2026-12-18");
    expect(jan[1]).toEqual(dec[1]);
    expect(jan[1].proceeds).toBe(rows[3].positions[1].expiryProceeds);
    expect(jan).toHaveLength(2);
    expect(s).toEqual(before);
  });
  it("uses before-expiry modeled option value at the selected checkpoint date", () => {
    const s = monthlyFixture(),
      row = projectMonthly(s)[0],
      sales = monthlyTaxSales(s, row);
    expect(sales[1]).toMatchObject({
      saleDate: "2026-10-31",
      proceeds: row.positions[1].holdingValue,
    });
    expect(sales[1].proceeds).not.toBe(row.positions[1].intrinsic);
  });
  it("groups an expired option only in its realization year rather than selling its carried cash in January", () => {
    const s = monthlyFixture(),
      settings = createTaxSettings(s.assets);
    settings.assumptions.forEach((a) => {
      a.treatment = "standard";
      a.acquiredDate = "2026-01-01";
    });
    const sales = monthlyTaxSales(s, projectMonthly(s)[3]),
      result = projectScenarioTax(settings, sales);
    expect(result.complete).toBe(true);
    expect(result.years.map((y) => y.saleYear)).toEqual([2026, 2027]);
    expect(result.years[0].shortTermGains).toBeCloseTo(
      sales[1].proceeds! - 109800,
      2,
    );
    expect(result.years[1].longTermGains).toBe(1100);
    expect(result.years[1].shortTermGains).toBe(0);
    expect(result.years[1].usesAssumedRules).toBe(true);
  });
  it("does not create a new realization for an option expired before capture, even with a supplied expiry price", () => {
    const s = monthlyFixture();
    s.assets[1].option!.expiration = "2026-09-01T20:00:00Z";
    s.monthly!.expiryPrices = [
      { symbol: "BTG", date: "2026-09-01", price: 50 },
    ];
    const sale = monthlyTaxSales(s, projectMonthly(s)[0])[1];
    expect(sale.proceeds).toBeNull();
    expect(sale.reason).toContain("Already expired at capture");
  });
  it("keeps missing projected price and a missing row unavailable without fabricating zero proceeds", () => {
    const s = monthlyFixture();
    s.monthly!.paths[0].prices[0] = null;
    const sales = monthlyTaxSales(s, projectMonthly(s)[0]);
    expect(sales.every((sale) => sale.proceeds == null)).toBe(true);
    expect(sales.every((sale) => Boolean(sale.reason))).toBe(true);
    expect(
      monthlyTaxSales(s).every(
        (sale) => sale.saleDate == null && sale.proceeds == null,
      ),
    ).toBe(true);
  });
  it("does not apply debt or interest to the asset proceeds or capital gains", () => {
    const s = monthlyFixture();
    s.portfolioSnapshots = [
      {
        id: "fixture-portfolio",
        name: "Options",
        cash: 1000,
        margin: {
          debt: 30000,
          aprPercent: 12,
          maintenancePercent: 30,
          dayCountBasis: 360,
        },
      },
    ];
    const sales = monthlyTaxSales(s, projectMonthly(s)[0]);
    const plain = structuredClone(s);
    delete plain.portfolioSnapshots;
    expect(sales).toEqual(monthlyTaxSales(plain, projectMonthly(plain)[0]));
    expect(targetTaxSales(s)).toEqual(targetTaxSales(plain));
  });
  it("uses final targets, actual valuation date, and selected option model without changing the scenario", () => {
    const s = monthlyFixture();
    s.assumptions.daysForward = 30;
    const before = structuredClone(s),
      model = targetTaxSales(s),
      intrinsic = targetTaxSales(s, "intrinsic");
    expect(model[0]).toMatchObject({ saleDate: "2026-10-17", proceeds: 1000 });
    expect(model[1].proceeds).toBe(
      valueAt(s.assets[1], 1, "model", s.assumptions, Date.parse(s.capturedAt)),
    );
    expect(intrinsic[1].proceeds).toBe(300000);
    expect(model[1].proceeds).not.toBe(intrinsic[1].proceeds);
    expect(s).toEqual(before);
  });
  it("requires a target and permits an explicit zero target as a real hypothetical loss", () => {
    const s = monthlyFixture();
    s.assets[0].target = null;
    expect(targetTaxSales(s)[0]).toMatchObject({
      proceeds: null,
      reason: expect.stringContaining("Enter this holding's target"),
    });
    s.assets[0].target = 0;
    expect(targetTaxSales(s)[0].proceeds).toBe(0);
  });
  it("rejects a target option sale after expiry rather than inventing earlier expiry proceeds", () => {
    const s = monthlyFixture();
    s.assumptions.daysForward = 150;
    expect(targetTaxSales(s)[1]).toMatchObject({
      proceeds: null,
      reason: expect.stringContaining("sale follows option expiration"),
    });
    s.assets[1].option!.expiration = "2026-09-01T20:00:00Z";
    s.assumptions.daysForward = 0;
    expect(targetTaxSales(s)[1].reason).toContain("already expired at capture");
  });
  it("uses intrinsic at the actual expiration instant and keeps its calendar sale date", () => {
    const s = monthlyFixture();
    s.assumptions.daysForward =
      (Date.parse(s.assets[1].option!.expiration) - Date.parse(s.capturedAt)) /
      86400000;
    expect(targetTaxSales(s)[1]).toMatchObject({
      saleDate: "2026-12-18",
      proceeds: 300000,
    });
  });
  it.each([
    ["2026-03-07T21:00:00Z", "2026-03-09", "2026-03-09T20:00:00.000Z", 2],
    ["2026-10-31T20:00:00Z", "2026-11-02", "2026-11-02T21:00:00.000Z", 2],
    ["2026-10-05T23:00:00Z", "2026-10-05", "2026-10-05T23:00:00.000Z", 0],
  ])(
    "links date edit %s → %s with the same actual model instant and Eastern financing day count",
    (capture, date, instant, days) => {
      const s = monthlyFixture();
      s.capturedAt = capture;
      const forward = targetDaysForSaleDate(s, date);
      expect(forward).not.toBeNull();
      s.assumptions.daysForward = forward!;
      expect(new Date(targetSaleAt(s)!).toISOString()).toBe(instant);
      expect(targetSaleDate(s)).toBe(date);
      expect(scenarioFinancing(s)?.elapsedDays).toBe(days);
    },
  );
  it.each([null, "", "2026-02-30", "2026-09-01", "2037-01-01"])(
    "rejects blank, impossible, past or out-of-horizon sale date %s",
    (date) => {
      expect(targetDaysForSaleDate(monthlyFixture(), date)).toBeNull();
    },
  );
  it("does not coerce cleared or malformed model dates to today's date or a zero-day sale", () => {
    const s = monthlyFixture();
    expect(
      targetTaxSales(s, "model", false).every(
        (sale) => sale.proceeds == null && sale.saleDate == null,
      ),
    ).toBe(true);
    s.capturedAt = "2026-02-30T20:00:00Z";
    expect(targetSaleAt(s)).toBeNull();
    s.capturedAt = "2026-09-17T16:00:00Z";
    s.assumptions.daysForward = NaN;
    expect(targetSaleAt(s)).toBeNull();
  });
  it("ignores zero-quantity closed holdings and makes overflow unavailable", () => {
    const s = monthlyFixture();
    s.assets[1].quantity = 0;
    s.assets[0].quantity = 1e14;
    s.assets[0].target = 1e16;
    const sales = targetTaxSales(s);
    expect(sales).toHaveLength(1);
    expect(sales[0].proceeds).toBeNull();
  });
});
