import { describe, expect, it } from "vitest";
import { landingScenario } from "@/lib/landing-scenario";
describe("landing-page illustrative scenarios", () => {
  it("values 228 TSLA shares at $2000 and includes remaining virtual cash", () => {
    const s = landingScenario("equity", 2000);
    expect(s.projectedHolding).toBe(456000);
    expect(s.cash).toBe(177028.6);
    expect(s.currentValue).toBe(249988.6);
    expect(s.projectedValue).toBe(633028.6);
  });
  it("converts the BTG market-cap target to intrinsic option value", () => {
    const s = landingScenario("option", 50);
    expect(s.targetPrice).toBeCloseTo(37.037037);
    expect(s.projectedHolding).toBe(1922222.22);
    expect(s.cash).toBe(140200);
    expect(s.projectedValue).toBe(2062422.22);
  });
  it("changes the projection when the target slider changes", () => {
    expect(landingScenario("equity", 1000).projectedValue).toBe(405028.6);
    expect(landingScenario("option", 10).projectedValue).toBe(284644.44);
  });
  it("shows downside without losing uninvested cash", () => {
    const s = landingScenario("equity", 0);
    expect(s.projectedHolding).toBe(0);
    expect(s.projectedValue).toBe(177028.6);
    expect(s.projectedValue).toBeLessThan(s.currentValue);
  });
  it("never gives a long option negative intrinsic value", () => {
    expect(landingScenario("option", 0).projectedHolding).toBe(0);
  });
  it.each([-1, NaN, Infinity])("rejects invalid target %s", (target) => {
    expect(() => landingScenario("equity", target)).toThrow();
  });
});
