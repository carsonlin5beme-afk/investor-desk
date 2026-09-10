import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
vi.mock("@/lib/prisma", () => ({
  prisma: { quoteCache: { findUnique: vi.fn(), upsert: vi.fn() } },
}));
vi.mock("@/server/providers/factory", () => ({
  quoteSourceFor: () => "alpaca-sip",
  providers: {
    equities: { getQuote: vi.fn(async () => null) },
    options: { getOptionQuote: vi.fn(async () => null) },
  },
}));
import { prisma } from "@/lib/prisma";
import { getLiveQuote } from "@/server/services/quote-service";
describe("feed-specific cache isolation", () => {
  it.each(["demo", "alpaca", "alpaca-iex", "tradier-delayed"])(
    "does not reuse %s prices when SIP is selected",
    async (source) => {
      vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue({
        symbol: "TSLA",
        assetClass: "EQUITY",
        source,
        bid: new Prisma.Decimal(300),
        ask: new Prisma.Decimal(301),
        last: null,
        mark: new Prisma.Decimal(300.5),
        asOf: new Date(),
        updatedAt: new Date(),
        impliedVolatility: null,
      });
      expect(await getLiveQuote("TSLA", "EQUITY")).toBeNull();
    },
  );
});

import { providers } from "@/server/providers/factory";
import { getQuoteResult } from "@/server/services/quote-service";
const cachedRow = () => ({
  symbol: "TSLA",
  assetClass: "EQUITY" as const,
  source: "alpaca-sip",
  bid: new Prisma.Decimal(300),
  ask: new Prisma.Decimal(301),
  last: null,
  mark: new Prisma.Decimal(300.5),
  asOf: new Date(),
  updatedAt: new Date(),
  impliedVolatility: null,
});
describe("execution refresh cannot authorize fills from cache", () => {
  it("rejects provider no-quote even if matching cache exists", async () => {
    vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue(cachedRow());
    vi.mocked(providers.equities.getQuote).mockResolvedValue(null);
    expect(await getLiveQuote("TSLA", "EQUITY", true)).toBeNull();
  });
  it("rejects provider failure instead of returning cache", async () => {
    vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue(cachedRow());
    vi.mocked(providers.equities.getQuote).mockRejectedValueOnce(
      new Error("Alpaca: credentials/entitlement (403)"),
    );
    const result = await getQuoteResult("TSLA", "EQUITY", true);
    expect(result.quote).toBeNull();
    expect(result.refreshFailed).toBe(true);
  });
  it("preserves original timestamp for valuation cache on refresh failure", async () => {
    const row = cachedRow();
    row.updatedAt = new Date(0);
    row.asOf = new Date("2026-01-01T00:00:00Z");
    vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue(row);
    vi.mocked(providers.equities.getQuote).mockResolvedValue(null);
    const result = await getQuoteResult("TSLA", "EQUITY");
    expect(result.quote?.asOf).toEqual(row.asOf);
    expect(result.refreshFailed).toBe(true);
  });
  it("does not let a forced execution join a dashboard cache-only request", async () => {
    vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue(cachedRow());
    vi.mocked(providers.equities.getQuote).mockResolvedValue(null);
    const [valuation, trade] = await Promise.all([
      getLiveQuote("TSLA", "EQUITY"),
      getLiveQuote("TSLA", "EQUITY", true),
    ]);
    expect(valuation?.mark).toBe(300.5);
    expect(trade).toBeNull();
  });
});
