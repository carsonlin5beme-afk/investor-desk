import { describe, expect, it } from "vitest";
import { longOptionProfit, parseHypotheticalPrice } from "@/lib/option-profit";

const terms = { strike: 100, premium: 5, quantity: 2, multiplier: 100 };
describe("long option expiration net profit", () => {
  it.each([
    ["CALL", 120, 3000],
    ["CALL", 100, -1000],
    ["CALL", 90, -1000],
    ["CALL", 0, -1000],
    ["CALL", 105, 0],
    ["PUT", 80, 3000],
    ["PUT", 100, -1000],
    ["PUT", 110, -1000],
    ["PUT", 0, 19000],
    ["PUT", 95, 0],
  ] as const)(
    "%s at $%s returns $%s after premium",
    (right, price, expected) => {
      const result = longOptionProfit({ ...terms, right }, price)!;
      expect(result.expirationProfit).toBe(expected);
      expect(result.premiumPaid).toBe(1000);
      expect(result.expirationValue - result.premiumPaid).toBe(expected);
    },
  );

  it("uses the actual multiplier and subtracts six-decimal premium once", () => {
    const result = longOptionProfit(
      {
        right: "CALL",
        strike: 12.5,
        premium: 2.350001,
        quantity: 3,
        multiplier: 50,
      },
      15,
    )!;
    expect(result.shares).toBe(150);
    expect(result.premiumPaid).toBeCloseTo(352.50015, 8);
    expect(result.expirationValue).toBe(375);
    expect(result.expirationProfit).toBeCloseTo(22.49985, 8);
    expect(result.breakEven).toBeCloseTo(14.850001, 10);
  });

  it("identifies unattainable and zero-price put break-even", () => {
    const put = { ...terms, right: "PUT" as const, strike: 10, quantity: 1 };
    expect(longOptionProfit({ ...put, premium: 11 }, 0)).toMatchObject({
      breakEven: -1,
      expirationProfit: -100,
    });
    expect(longOptionProfit({ ...put, premium: 10 }, 0)).toMatchObject({
      breakEven: 0,
      expirationProfit: 0,
    });
  });

  it.each([
    { quantity: 0 },
    { quantity: -1 },
    { quantity: 1.5 },
    { quantity: NaN },
    { quantity: Infinity },
    { multiplier: 0 },
    { multiplier: 1.5 },
    { multiplier: Infinity },
    { strike: 0 },
    { strike: -1 },
    { strike: NaN },
    { premium: -1 },
    { premium: Infinity },
  ])("refuses invalid terms %j rather than assuming a contract", (invalid) => {
    expect(
      longOptionProfit({ ...terms, right: "CALL", ...invalid }, 120),
    ).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity, -0.01])(
    "refuses invalid target %s",
    (price) => {
      expect(longOptionProfit({ ...terms, right: "PUT" }, price)).toBeNull();
    },
  );

  it("does not return an overflowing dollar value", () => {
    expect(
      longOptionProfit({ ...terms, right: "CALL" }, Number.MAX_VALUE),
    ).toBeNull();
  });
});

describe("hypothetical price input", () => {
  it.each([
    "",
    " ",
    "-1",
    "NaN",
    "Infinity",
    "1e309",
    "0x10",
    "1,000",
    "12 USD",
    ".",
    "1e",
  ])("keeps malformed or missing price %j unavailable", (raw) =>
    expect(parseHypotheticalPrice(raw)).toBeNull(),
  );
  it.each([
    ["0", 0],
    ["0.0", 0],
    [" 12.5001 ", 12.5001],
    [".25", 0.25],
    ["1e2", 100],
  ] as const)("accepts finite nonnegative price %j", (raw, expected) => {
    expect(parseHypotheticalPrice(raw)).toBe(expected);
  });
});
