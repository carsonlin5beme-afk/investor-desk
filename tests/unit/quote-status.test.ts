import { describe, expect, it } from "vitest";
import { quoteStatus } from "@/lib/quote-status";
const now = Date.parse("2026-09-07T12:00:00Z");
const base = {
  symbol: "PL",
  source: "alpaca-sip",
  hasQuote: true,
  configured: true,
  asOf: new Date(now).toISOString(),
  now,
};
describe("truthful quote status", () => {
  it("offers sample recovery for unsupported instruments without claiming a live quote", () => {
    const s = quoteStatus({
      ...base,
      symbol: "UNKNOWNFIXTURE",
      source: "demo",
      hasQuote: false,
      sampleSupported: false,
    });
    expect(s.code).toBe("DEMO_UNAVAILABLE");
    expect(s.blocking).toBe(true);
    expect(s.message).toContain("illustrative dataset");
    expect(s.message).toContain("Try PL");
  });
  it("never labels sample data as live", () => {
    expect(quoteStatus({ ...base, source: "demo" }).code).toBe("SAMPLE");
  });
  it("identifies missing credentials", () => {
    expect(
      quoteStatus({ ...base, configured: false, hasQuote: false }).code,
    ).toBe("NOT_CONFIGURED");
  });
  it("blocks failed refresh even if a cached quote is fresh", () => {
    expect(quoteStatus({ ...base, refreshFailed: true }).blocking).toBe(true);
  });
  it.each(["2020-01-01", "invalid", new Date(now + 6000).toISOString()])(
    "blocks stale/invalid/future timestamp %s",
    (asOf) => {
      expect(quoteStatus({ ...base, asOf }).code).toBe("STALE");
    },
  );
  it.each(["tradier-delayed", "alpaca-indicative"])("blocks %s", (source) => {
    expect(quoteStatus({ ...base, source }).code).toBe("DELAYED");
  });
  it("distinguishes IEX from consolidated coverage", () => {
    expect(quoteStatus({ ...base, source: "alpaca-iex" }).code).toBe(
      "PARTIAL_FEED",
    );
    expect(quoteStatus(base).code).toBe("PROVIDER_QUOTE");
  });
});
