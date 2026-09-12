import { expect, it } from "vitest";
import { blackScholesPrice } from "@/server/domain/black-scholes";
import { projectOptionModelValue } from "@/server/domain/projection";
const price = (spot: number, isCall = false, volatility = 0.3, years = 1) =>
  blackScholesPrice({
    spot,
    strike: 100,
    isCall,
    volatility,
    timeToExpiryYears: years,
    riskFreeRate: 0.04,
  });
it("converges to discounted strike at a zero-spot put target", () => {
  expect(price(0)).toBeCloseTo(100 * Math.exp(-0.04), 10);
  expect(price(0.000001)).toBeCloseTo(price(0), 5);
  expect(price(0, true)).toBe(0);
  expect(
    projectOptionModelValue({
      right: "PUT",
      strike: 100,
      contracts: 1,
      multiplier: 100,
      targetUnderlyingPrice: 0,
      impliedVolatility: 0.3,
      expiration: new Date("2027-01-01Z"),
      now: new Date("2026-01-01Z"),
    }),
  ).toBe(9607.89);
});
it("uses discounted forward payoff at zero volatility and intrinsic at expiry", () => {
  expect(price(100, true, 0)).toBeCloseTo(100 - 100 * Math.exp(-0.04), 10);
  expect(price(100, false, 0)).toBe(0);
  expect(price(90, false, 0)).toBeCloseTo(100 * Math.exp(-0.04) - 90, 10);
  expect(price(0, false, 0, 0)).toBe(100);
  expect(price(130, true, 0.3, 0)).toBe(30);
  expect(price(70, false, 0.3, -1)).toBe(30);
});
it.each([NaN, Infinity, -1])(
  "rejects invalid spot %s without leaking a nonfinite valuation",
  (spot) => {
    expect(() => price(spot)).toThrow("Invalid Black-Scholes");
  },
);
it("keeps call/put parity at ordinary and boundary spots", () => {
  for (const spot of [0, 0.000001, 80, 100, 200])
    for (const vol of [0, 0.01, 0.3, 1])
      expect(price(spot, true, vol) - price(spot, false, vol)).toBeCloseTo(
        spot - 100 * Math.exp(-0.04),
        5,
      );
});
it.each([
  { contracts: NaN },
  { contracts: Infinity },
  { contracts: -1 },
  { multiplier: 0 },
  { multiplier: Infinity },
])("does not emit an invalid position model for %j", (invalid) => {
  expect(
    projectOptionModelValue({
      right: "PUT",
      strike: 100,
      contracts: 1,
      multiplier: 100,
      targetUnderlyingPrice: 90,
      impliedVolatility: 0.3,
      expiration: new Date("2027-01-15T21:00:00Z"),
      now: new Date("2026-09-11T16:00:00Z"),
      ...invalid,
    }),
  ).toBeNull();
});
