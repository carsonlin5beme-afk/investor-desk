import { AssetClass } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export interface QuoteUpsertInput {
  symbol: string;
  assetClass: AssetClass;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  source: string;
  asOf: Date;
}

export const upsertQuoteCache = async (input: QuoteUpsertInput) =>
  prisma.quoteCache.upsert({
    where: {
      symbol_assetClass: {
        symbol: input.symbol,
        assetClass: input.assetClass,
      },
    },
    update: {
      bid: input.bid,
      ask: input.ask,
      last: input.last,
      mark: input.mark,
      source: input.source,
      asOf: input.asOf,
    },
    create: {
      symbol: input.symbol,
      assetClass: input.assetClass,
      bid: input.bid,
      ask: input.ask,
      last: input.last,
      mark: input.mark,
      source: input.source,
      asOf: input.asOf,
    },
  });

export const getQuoteCache = async (symbol: string, assetClass: AssetClass) =>
  prisma.quoteCache.findUnique({
    where: {
      symbol_assetClass: {
        symbol,
        assetClass,
      },
    },
  });

export const getQuoteCachesForSymbols = async (
  pairs: Array<{ symbol: string; assetClass: AssetClass }>,
) =>
  prisma.quoteCache.findMany({
    where: {
      OR: pairs.map((pair) => ({
        symbol: pair.symbol,
        assetClass: pair.assetClass,
      })),
    },
  });
