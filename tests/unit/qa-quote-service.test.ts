import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({
  prisma: { quoteCache: { findUnique: vi.fn(), upsert: vi.fn() } },
}));
vi.mock("@/server/providers/factory", () => ({
  quoteSourceFor: () => "alpaca-sip",
  providers: {
    equities: { getQuote: vi.fn() },
    options: { getOptionQuote: vi.fn() },
  },
}));
import { prisma } from "@/lib/prisma";
import { providers } from "@/server/providers/factory";
import { getLiveQuote } from "@/server/services/quote-service";
const source = "alpaca-sip";
const row = () => ({
  symbol: "QASTRESS",
  assetClass: "EQUITY" as const,
  source,
  bid: new Prisma.Decimal(99),
  ask: new Prisma.Decimal(101),
  mark: new Prisma.Decimal(100),
  last: null,
  impliedVolatility: null,
  asOf: new Date("2020-01-01"),
  updatedAt: new Date(),
});
const live = () => ({
  symbol: "QASTRESS",
  assetClass: "EQUITY" as const,
  source,
  bid: 199,
  ask: 201,
  mark: 200,
  last: null,
  asOf: new Date(),
});
beforeEach(() => {
  vi.mocked(prisma.quoteCache.findUnique).mockReset();
  vi.mocked(prisma.quoteCache.upsert).mockReset();
  vi.mocked(providers.equities.getQuote).mockReset();
});
describe("QA: quote service failure/stale/force boundaries (mocked DB and provider)", () => {
  it("retains old quote and genuine timestamp on provider failure", async () => {
    vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue({
      ...row(),
      updatedAt: new Date(0),
    });
    vi.mocked(providers.equities.getQuote).mockRejectedValue(
      new Error("simulated 503"),
    );
    const result = await getLiveQuote("QASTRESS", "EQUITY");
    expect(result?.mark).toBe(100);
    expect(result?.asOf.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(prisma.quoteCache.upsert).not.toHaveBeenCalled();
  });
  it("does not return cached executable prices after a forced refresh failure", async () => {
    vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue(row());
    vi.mocked(providers.equities.getQuote).mockRejectedValue(
      new Error("simulated 503"),
    );
    expect(await getLiveQuote("QASTRESS", "EQUITY", true)).toBeNull();
    expect(prisma.quoteCache.upsert).not.toHaveBeenCalled();
  });
  it("returns unavailable instead of inventing a quote when both cache and provider fail", async () => {
    vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue(null);
    vi.mocked(providers.equities.getQuote).mockRejectedValue(
      new Error("simulated network failure"),
    );
    expect(await getLiveQuote("QASTRESS", "EQUITY", true)).toBeNull();
    expect(prisma.quoteCache.upsert).not.toHaveBeenCalled();
  });
  it("does not let a normal cache read swallow a simultaneous forced refresh", async () => {
    vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue(row());
    vi.mocked(providers.equities.getQuote).mockResolvedValue(live());
    const normal = getLiveQuote("QASTRESS", "EQUITY");
    const forced = getLiveQuote("QASTRESS", "EQUITY", true);
    await normal;
    expect((await forced)?.ask).toBe(201);
    expect(providers.equities.getQuote).toHaveBeenCalledTimes(1);
  });
  it("coalesces 12 forced refreshes and releases them for the next request", async () => {
    vi.mocked(prisma.quoteCache.findUnique).mockResolvedValue(null);
    vi.mocked(providers.equities.getQuote).mockResolvedValue(live());
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        getLiveQuote("QASTRESS", "EQUITY", true),
      ),
    );
    expect(results.every((q) => q?.ask === 201)).toBe(true);
    expect(providers.equities.getQuote).toHaveBeenCalledTimes(1);
    await getLiveQuote("QASTRESS", "EQUITY", true);
    expect(providers.equities.getQuote).toHaveBeenCalledTimes(2);
  });
});
