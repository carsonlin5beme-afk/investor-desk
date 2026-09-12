import { AssetClass } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { finitePrice, quoteTime } from "@/server/providers/alpaca-client";
import { MarketQuote } from "@/server/domain/types";
import { providers, quoteSourceFor } from "@/server/providers/factory";
import { acceptsQuoteSource } from "@/server/providers/quote-sources";
import { isStandardOptionContract } from "@/server/providers/option-contract";
export type LiveQuoteResult = MarketQuote;
export type QuoteResult = { quote: MarketQuote | null; refreshFailed: boolean };

// Option valuation uses the current two-sided book only. A zero bid can still
// bound a midpoint estimate, but neither the midpoint nor a historical trade
// is an executable sell price. Missing/crossed books fall back to cost basis.
export function optionMidpoint(bid: unknown, ask: unknown): number | null {
  const b = finitePrice(bid),
    a = finitePrice(ask);
  return b !== null && a !== null && a > 0 && b <= a ? (b + a) / 2 : null;
}

const scope = globalThis as typeof globalThis & {
  quoteResultRequests?: Map<string, Promise<QuoteResult>>;
};
const pending = (scope.quoteResultRequests ??= new Map());
export const getQuoteResult = async (
  symbol: string,
  assetClass: AssetClass,
  force = false,
): Promise<QuoteResult> => {
  const expectedSource = quoteSourceFor(assetClass);
  const key = `${expectedSource}:${assetClass}:${symbol}:${force ? "fresh" : "cached"}`;
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
          mark:
            assetClass === "OPTION"
              ? optionMidpoint(row.bid?.toNumber(), row.ask?.toNumber())
              : (row.mark?.toNumber() ?? null),
          source: row.source,
          asOf: row.asOf,
          impliedVolatility: row.impliedVolatility,
        }
      : null;
    if (!force && valid && Date.now() - row.updatedAt.getTime() < 15000)
      return { quote: cached, refreshFailed: false };
    try {
      const raw =
        assetClass === "EQUITY"
          ? await providers.equities.getQuote(symbol, { forceRefresh: force })
          : await providers.options.getOptionQuote(symbol);
      if (!raw) return { quote: force ? null : cached, refreshFailed: true };
      if (
        assetClass === "OPTION" &&
        (!("contractSymbol" in raw) || !isStandardOptionContract(symbol, raw))
      )
        throw new Error("Unexpected or nonstandard option contract");
      if (
        assetClass === "EQUITY" &&
        (!("symbol" in raw) ||
          raw.symbol !== symbol ||
          raw.assetClass !== assetClass)
      )
        throw new Error("Unexpected quote instrument");
      if (raw.source && !acceptsQuoteSource(expectedSource, raw.source))
        throw new Error("Unexpected quote feed source");
      const quote: MarketQuote = {
        symbol,
        assetClass,
        bid: finitePrice(raw.bid),
        ask: finitePrice(raw.ask),
        last: finitePrice(raw.last),
        mark:
          assetClass === "OPTION"
            ? optionMidpoint(raw.bid, raw.ask)
            : raw.bid != null && raw.ask != null && raw.bid > raw.ask
              ? null
              : finitePrice(raw.mark),
        source: raw.source ?? expectedSource,
        asOf:
          raw.asOf && Number.isFinite(raw.asOf.getTime())
            ? quoteTime(raw.asOf.toISOString())
            : new Date(0),
        impliedVolatility:
          "impliedVolatility" in raw ? raw.impliedVolatility : null,
      };
      await prisma.quoteCache.upsert({
        where: { symbol_assetClass: { symbol, assetClass } },
        create: quote,
        update: quote,
      });
      return { quote, refreshFailed: false };
    } catch (error) {
      console.error("[provider:quote]", {
        symbol,
        category: error instanceof Error ? error.message : "unavailable",
      });
      return { quote: force ? null : cached, refreshFailed: true };
    }
  })();
  pending.set(key, request);
  try {
    return await request;
  } finally {
    pending.delete(key);
  }
};
export const quoteMark = (quote: MarketQuote | null) => {
  if (!quote) return null;
  // Apply this on cache reads too: older cached marks may have used a trade.
  if (quote.assetClass === "OPTION")
    return optionMidpoint(quote.bid, quote.ask);
  const trade = finitePrice(quote.last);
  if (quote.bid != null && quote.ask != null && quote.bid > quote.ask)
    return trade;
  return (
    finitePrice(quote.mark) ??
    trade ??
    finitePrice(quote.bid) ??
    finitePrice(quote.ask)
  );
};

// Trades always require a successful provider refresh; valuations may retain timestamped cache.
export const getLiveQuote = async (
  symbol: string,
  assetClass: AssetClass,
  force = false,
) => (await getQuoteResult(symbol, assetClass, force)).quote;
