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
