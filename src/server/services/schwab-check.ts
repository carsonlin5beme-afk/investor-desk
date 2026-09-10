import { env } from "@/lib/env";
import { isQuoteStale } from "@/server/domain/staleness";
export type FeedCheck = {
  name: string;
  status: string;
  detail: string;
  asOf?: string;
};
export function schwabQuoteCheck(
  name: string,
  quote:
    | { bid: number | null; ask: number | null; source?: string; asOf?: Date }
    | null
    | undefined,
): FeedCheck {
  if (!quote)
    return {
      name,
      status: "authorized_no_quote",
      detail:
        "The request succeeded but no matching supported instrument was returned. Feed access and symbol coverage remain unverified.",
    };
  const asOf =
    quote.asOf &&
    Number.isFinite(quote.asOf.getTime()) &&
    quote.asOf.getTime() > 0
      ? quote.asOf.toISOString()
      : undefined;
  if (quote.source?.endsWith("-delayed"))
    return {
      name,
      status: "accessible_delayed",
      detail:
        "Schwab explicitly marked this quote delayed. Simulated fills are blocked.",
      asOf,
    };
  if (quote.source !== "schwab-equity" && quote.source !== "schwab-option")
    return {
      name,
      status: "realtime_unconfirmed",
      detail:
        "The request succeeded, but Schwab did not confirm real-time status. Simulated fills are blocked.",
      asOf,
    };
  if (!asOf)
    return {
      name,
      status: "authorized_no_timestamp",
      detail:
        "Schwab confirmed real-time status but supplied no usable quote timestamp. Simulated fills are blocked.",
    };
  if (isQuoteStale(quote.asOf!, env.QUOTE_STALE_SECONDS))
    return {
      name,
      status: "accessible_stale",
      detail:
        "Schwab confirmed real-time status, but this quote is old or has an invalid future timestamp. Closed markets and illiquidity can cause old quotes; simulated fills need a fresh quote.",
      asOf,
    };
  if (
    quote.bid == null ||
    quote.ask == null ||
    !Number.isFinite(quote.bid) ||
    !Number.isFinite(quote.ask) ||
    quote.bid <= 0 ||
    quote.ask <= 0 ||
    quote.bid > quote.ask
  )
    return {
      name,
      status: "accessible_no_bid_ask",
      detail:
        "A recent real-time quote was returned, but its bid/ask cannot authorize a simulated fill.",
      asOf,
    };
  return {
    name,
    status: "accessible_fresh",
    detail:
      "A recent real-time quote with a usable bid/ask was returned for this instrument. This does not guarantee coverage of every symbol; execution fetches a fresh quote again.",
    asOf,
  };
}
