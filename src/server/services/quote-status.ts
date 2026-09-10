import { env } from "@/lib/env";
import { quoteStatus } from "@/lib/quote-status";
import { sampleSymbols } from "@/server/providers/demo";
import {
  equitiesConfigured,
  optionsConfigured,
  quoteSourceFor,
} from "@/server/providers/factory";
import type { QuoteResult } from "./quote-service";
export function dataStatus(
  symbol: string,
  asset: "EQUITY" | "OPTION",
  result: QuoteResult,
) {
  return quoteStatus({
    symbol,
    source: result.quote?.source ?? quoteSourceFor(asset),
    asOf: result.quote?.asOf.toISOString(),
    hasQuote: Boolean(result.quote),
    configured: asset === "EQUITY" ? equitiesConfigured() : optionsConfigured(),
    sampleSupported:
      asset === "OPTION" || sampleSymbols.some((s) => s.symbol === symbol),
    refreshFailed: result.refreshFailed,
    staleSeconds: env.QUOTE_STALE_SECONDS,
  });
}
export function optionsSetupIssue(symbol: string) {
  if (
    env.MARKET_DATA_MODE === "demo" &&
    !sampleSymbols.some((s) => s.symbol === symbol)
  )
    return quoteStatus({
      symbol,
      source: "demo",
      hasQuote: false,
      sampleSupported: false,
    });
  if (env.MARKET_DATA_MODE !== "demo" && !optionsConfigured())
    return quoteStatus({
      symbol,
      source: quoteSourceFor("OPTION"),
      hasQuote: false,
      configured: false,
    });
  return null;
}
