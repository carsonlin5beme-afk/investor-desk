import { describe, expect, it } from "vitest";
import {
  assertOptionNotExpired,
  resolveOptionExpiry,
  optionExpirationDate,
  optionHasExpired,
} from "@/lib/option-expiration";
import { decodeContract, DemoOptionsProvider } from "@/server/providers/demo";

describe("published Eastern option expiry policy", () => {
  it.each([
    ["2027-01-15", "AAPL", "2027-01-15T21:00:00.000Z"],
    ["2027-01-15", "SPY", "2027-01-15T21:15:00.000Z"],
    ["2027-01-15", "QQQ", "2027-01-15T21:15:00.000Z"],
    ["2027-01-15", "VOO", "2027-01-15T21:15:00.000Z"],
    ["2027-07-16", "AAPL", "2027-07-16T20:00:00.000Z"],
    ["2027-07-16", "SPY", "2027-07-16T20:15:00.000Z"],
    ["2026-11-27", "AAPL", "2026-11-27T18:00:00.000Z"],
    ["2026-11-27", "VOO", "2026-11-27T18:15:00.000Z"],
    ["2028-07-03", "AAPL", "2028-07-03T17:00:00.000Z"],
    ["2028-07-03", "QQQ", "2028-07-03T17:15:00.000Z"],
    ["2027-12-31", "AAPL", "2027-12-31T21:00:00.000Z"],
  ])(
    "resolves %s %s and enforces before/at/after %s",
    (date, symbol, expected) => {
      const expiry = resolveOptionExpiry(date, symbol);
      expect(expiry.tradingCutoffAt?.toISOString()).toBe(expected);
      expect(() =>
        assertOptionNotExpired(date, symbol, Date.parse(expected) - 1),
      ).not.toThrow();
      for (const delta of [0, 1])
        expect(() =>
          assertOptionNotExpired(date, symbol, Date.parse(expected) + delta),
        ).toThrow("Expired contracts");
    },
  );
  it("normalizes the legacy stored UTC hour from its date, without changing contract identity", () => {
    const old = new Date("2027-01-15T20:00:00Z");
    expect(
      resolveOptionExpiry(old, "AAPL").modelExpirationAt.toISOString(),
    ).toBe("2027-01-15T21:00:00.000Z");
    expect(decodeContract("AAPL270115C00100000").expiration.toISOString()).toBe(
      "2027-01-15T21:00:00.000Z",
    );
    expect(optionExpirationDate(old)).toBe("2027-01-15");
    expect(() =>
      assertOptionNotExpired(old, "AAPL", Date.parse("2027-01-15T20:30:00Z")),
    ).not.toThrow();
  });
  it.each([
    "2026-06-19",
    "2026-07-03",
    "2027-06-18",
    "2027-12-24",
    "2028-01-01",
  ])("rejects known closed expiry %s without rolling its identity", (date) => {
    const expiry = resolveOptionExpiry(date, "SPY");
    expect(expiry).toMatchObject({
      expirationDate: date,
      tradingCutoffAt: null,
      scheduleStatus: "CLOSED",
    });
    expect(() =>
      assertOptionNotExpired(date, "SPY", Date.parse("2026-01-01Z")),
    ).toThrow("non-trading date");
  });
  it("does not invent a holiday calendar beyond coverage or block earlier LEAPS trades", () => {
    const expiry = resolveOptionExpiry("2030-01-18", "SPY");
    expect(expiry).toMatchObject({
      scheduleStatus: "ASSUMED",
      tradingCutoffAt: null,
    });
    expect(() =>
      assertOptionNotExpired(
        "2030-01-18",
        "SPY",
        Date.parse("2029-06-01T16:00:00Z"),
      ),
    ).not.toThrow();
    expect(() =>
      assertOptionNotExpired(
        "2030-01-18",
        "SPY",
        Date.parse("2030-01-18T15:00:00Z"),
      ),
    ).toThrow("cutoff is unavailable");
    for (const instant of [
      "2030-01-18T21:14:59Z",
      "2030-01-18T21:15:00Z",
      "2030-01-18T23:59:59Z",
      "2030-01-19T04:59:59Z",
    ]) {
      expect(optionHasExpired(expiry, Date.parse(instant))).toBe(false);
      expect(() =>
        assertOptionNotExpired("2030-01-18", "SPY", Date.parse(instant)),
      ).toThrow("cutoff is unavailable");
    }
    expect(optionHasExpired(expiry, Date.parse("2030-01-19T05:00:00Z"))).toBe(
      true,
    );
    expect(() =>
      assertOptionNotExpired(
        "2030-01-18",
        "SPY",
        Date.parse("2030-01-19T05:00:00Z"),
      ),
    ).toThrow("Expired contracts");
  });
  it.each(["2027-02-29", "2026-13-01", "2026-00-01", "2026-04-31", "invalid"])(
    "rejects malformed calendar date %s",
    (date) => {
      expect(() => resolveOptionExpiry(date, "AAPL")).toThrow();
    },
  );
  it("applies VOO's published late-close effective date", () => {
    expect(
      resolveOptionExpiry("2026-02-20", "VOO").tradingCutoffAt?.toISOString(),
    ).toBe("2026-02-20T21:00:00.000Z");
    expect(
      resolveOptionExpiry("2026-02-27", "VOO").tradingCutoffAt?.toISOString(),
    ).toBe("2026-02-27T21:15:00.000Z");
  });
});
