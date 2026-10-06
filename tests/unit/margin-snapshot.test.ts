import { describe, it, expect } from "vitest";
import {
  snapshot,
  validateWorkspaceValue,
  scenarioFinancing,
  scenarioTotalAt,
  scenarioSchema,
  defaultAssumptions,
} from "@/lib/studio";
import {
  monthlyPortfolioFixture,
  monthlyFixture,
} from "../fixtures/monthly-scenario";
const settings = {
  debt: 10000,
  aprPercent: 12,
  maintenancePercent: 25,
  dayCountBasis: 360 as const,
};
const frozen = () => {
  const p = { ...monthlyPortfolioFixture(), margin: { ...settings } };
  return { p, s: snapshot([p], "Frozen") };
};
describe("Frozen margin scenario persistence", () => {
  it("freezes cash and every loan term independently of future portfolio edits", () => {
    const { p, s } = frozen();
    p.margin.debt = 42;
    p.margin.aprPercent = 1;
    p.cashBalance = 88;
    expect(s.portfolioSnapshots).toEqual([
      { id: p.id, name: p.name, cash: 1000, margin: settings },
    ]);
    expect(s.cash).toBe(1000);
    const saved = validateWorkspaceValue(
      `scenario:${s.id}`,
      JSON.parse(JSON.stringify(s)),
    );
    expect(saved).toEqual(s);
  });
  it.each(["duplicate", "missing", "cash", "subcent"])(
    "rejects malformed frozen account scope: %s",
    (kind) => {
      const { s } = frozen();
      if (kind === "duplicate")
        s.portfolioSnapshots!.push({ ...s.portfolioSnapshots![0] });
      if (kind === "missing") s.assets[0].portfolioId = "other";
      if (kind === "cash") s.portfolioSnapshots![0].cash = 999;
      if (kind === "subcent") s.portfolioSnapshots![0].cash = 0.005;
      expect(() => validateWorkspaceValue(`scenario:${s.id}`, s)).toThrow();
    },
  );
  it("legacy omitted accounts preserve the old zero-debt behavior", () => {
    const s = monthlyFixture();
    expect(scenarioSchema.parse(s).portfolioSnapshots).toBeUndefined();
    expect(scenarioFinancing(s)).toMatchObject({
      principal: 0,
      interest: 0,
      outstandingDebt: 0,
    });
    expect(scenarioTotalAt(s, 0)).toBe(110700);
  });
  it("uses captured loan APR rather than the Black-Scholes rate and supports both date bases", () => {
    const { s } = frozen();
    s.capturedAt = "2026-10-01T16:00:00Z";
    s.assumptions = { ...defaultAssumptions, daysForward: 30, rate: 0.5 };
    expect(scenarioFinancing(s)).toEqual({
      principal: 10000,
      interest: 100.48,
      outstandingDebt: 10100.48,
      elapsedDays: 30,
    });
    expect(scenarioTotalAt(s, 0)).toBe(100599.52);
    s.portfolioSnapshots![0].margin.dayCountBasis = 365;
    expect(scenarioFinancing(s)?.interest).toBe(99.1);
  });
  it("keeps zero-day principal separate from financing expense", () => {
    const { s } = frozen();
    expect(scenarioFinancing(s)).toMatchObject({
      principal: 10000,
      interest: 0,
      outstandingDebt: 10000,
      elapsedDays: 0,
    });
    expect(scenarioTotalAt(s, 0)).toBe(100700);
  });
  it("does not turn overflow into a fabricated zero-interest result", () => {
    const { s } = frozen();
    s.portfolioSnapshots![0].margin.aprPercent = Number.MAX_VALUE;
    s.assumptions.daysForward = 3650;
    expect(scenarioFinancing(s)).toBeNull();
    expect(scenarioTotalAt(s, 1)).toBeNaN();
  });
});
