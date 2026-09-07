import { AssetClass } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MarketQuote } from "@/server/domain/types";
import { providers, quoteSourceFor } from "@/server/providers/factory";
export type LiveQuoteResult = MarketQuote;
const scope = globalThis as typeof globalThis & {
  quoteRequests?: Map<string, Promise<MarketQuote | null>>;
};
const pending = (scope.quoteRequests ??= new Map());
export const getLiveQuote = async (
  symbol: string,
  assetClass: AssetClass,
  force = false,
): Promise<MarketQuote | null> => {
  const expectedSource = quoteSourceFor(assetClass);
  const key = `${expectedSource}:${assetClass}:${symbol}`;
  if (pending.has(key)) return pending.get(key)!;
  const request = (async () => {
    const row = await prisma.quoteCache.findUnique({
      where: { symbol_assetClass: { symbol, assetClass } },
    });
    const valid = row && row.source === expectedSource;
    const cached: MarketQuote | null = valid
      ? {
          symbol,
          assetClass,
          bid: row.bid?.toNumber() ?? null,
          ask: row.ask?.toNumber() ?? null,
          last: row.last?.toNumber() ?? null,
          mark: row.mark?.toNumber() ?? null,
          source: row.source,
          asOf: row.asOf,
          impliedVolatility: row.impliedVolatility,
        }
      : null;
    if (!force && valid && Date.now() - row.updatedAt.getTime() < 15000)
      return cached;
    try {
      const raw =
        assetClass === "EQUITY"
          ? await providers.equities.getQuote(symbol)
          : await providers.options.getOptionQuote(symbol);
      if (!raw) return cached;
      const quote: MarketQuote = {
        symbol,
        assetClass,
        bid: raw.bid,
        ask: raw.ask,
        last: raw.last,
        mark: raw.mark,
        source: raw.source ?? expectedSource,
        asOf: raw.asOf ?? new Date(0),
        impliedVolatility:
          "impliedVolatility" in raw ? raw.impliedVolatility : null,
      };
      await prisma.quoteCache.upsert({
        where: { symbol_assetClass: { symbol, assetClass } },
        create: quote,
        update: quote,
      });
      return quote;
    } catch (error) {
      console.error("[provider:quote]", {
        symbol,
        category: error instanceof Error ? error.message : "unavailable",
      });
      return cached;
    }
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
};
export const quoteMark = (quote: MarketQuote | null) =>
  quote?.mark ?? quote?.last ?? quote?.bid ?? quote?.ask ?? null;
