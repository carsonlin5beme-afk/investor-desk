import { AssetClass } from "@prisma/client";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { emitQuoteEvent } from "@/server/jobs/quote-bus";
import { providers } from "@/server/providers/factory";
import { upsertQuoteCache } from "@/server/repositories/quote-repository";

interface PortfolioJobHandles {
  stopEquitySubscription?: () => void;
  optionInterval?: NodeJS.Timeout;
  symbolsHash: string;
}

const getState = () => {
  const key = "__investorDeskQuoteJobs" as const;
  const scope = globalThis as typeof globalThis & {
    [key]?: Map<string, PortfolioJobHandles>;
  };

  if (!scope[key]) {
    scope[key] = new Map<string, PortfolioJobHandles>();
  }

  return scope[key];
};

const persistAndEmit = async (quote: {
  symbol: string;
  assetClass: AssetClass;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  source: string;
  asOf: Date;
}) => {
  await upsertQuoteCache(quote);
  emitQuoteEvent({
    ...quote,
    asOf: quote.asOf.toISOString(),
  });
};

const symbolsDigest = (equities: string[], options: string[]) =>
  `${equities.slice().sort().join(",")}|${options.slice().sort().join(",")}`;

export const stopQuoteJobsForPortfolio = (portfolioId: string) => {
  const state = getState();
  const handles = state.get(portfolioId);
  if (!handles) {
    return;
  }

  handles.stopEquitySubscription?.();
  if (handles.optionInterval) {
    clearInterval(handles.optionInterval);
  }

  state.delete(portfolioId);
};

export const ensureQuoteJobsForPortfolio = async (portfolioId: string) => {
  const positions = await prisma.position.findMany({
    where: { portfolioId },
    include: { optionDetails: true },
  });

  const equitySymbols = positions
    .filter((position) => position.assetClass === AssetClass.EQUITY)
    .map((position) => position.symbol.toUpperCase());

  const optionContracts = positions
    .filter((position) => position.assetClass === AssetClass.OPTION)
    .map((position) => position.optionDetails?.optionSymbol ?? position.symbol)
    .filter(Boolean) as string[];

  const digest = symbolsDigest(equitySymbols, optionContracts);
  const state = getState();
  const existing = state.get(portfolioId);

  if (existing && existing.symbolsHash === digest) {
    return;
  }

  stopQuoteJobsForPortfolio(portfolioId);

  const handles: PortfolioJobHandles = { symbolsHash: digest };

  if (equitySymbols.length > 0) {
    handles.stopEquitySubscription = await providers.equities.subscribe(
      equitySymbols,
      (quote) => {
        void persistAndEmit({
          symbol: quote.symbol,
          assetClass: AssetClass.EQUITY,
          bid: quote.bid,
          ask: quote.ask,
          last: quote.last,
          mark: quote.mark,
          source: quote.source,
          asOf: quote.asOf,
        });
      },
      (error) => {
        console.error("equity stream error", error);
      },
    );

    const initialQuotes = await providers.equities.getQuotes(equitySymbols);
    await Promise.all(
      initialQuotes.map((quote) =>
        persistAndEmit({
          symbol: quote.symbol,
          assetClass: AssetClass.EQUITY,
          bid: quote.bid,
          ask: quote.ask,
          last: quote.last,
          mark: quote.mark,
          source: quote.source,
          asOf: quote.asOf,
        }),
      ),
    );
  }

  if (optionContracts.length > 0) {
    const pollOptions = async () => {
      await Promise.all(
        optionContracts.map(async (contractSymbol) => {
          try {
            const quote =
              await providers.options.getOptionQuote(contractSymbol);
            if (!quote) {
              return;
            }

            await persistAndEmit({
              symbol: quote.contractSymbol,
              assetClass: AssetClass.OPTION,
              bid: quote.bid,
              ask: quote.ask,
              last: quote.last,
              mark: quote.mark,
              source: quote.source ?? "unavailable",
              asOf: quote.asOf ?? new Date(0),
            });
          } catch (error) {
            console.error("options poll error", error);
          }
        }),
      );
    };

    await pollOptions();
    handles.optionInterval = setInterval(
      pollOptions,
      env.OPTIONS_POLL_SECONDS * 1000,
    );
  }

  state.set(portfolioId, handles);
};
