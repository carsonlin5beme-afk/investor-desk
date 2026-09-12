export type ClosedSessionBasis = {
  kind: "CLOSED_SESSION_LIMIT";
  quoteSource: string;
  quoteAsOf: string;
  quoteBid: number;
  quoteAsk: number;
  sessionDate: string;
  nextOpen: string;
  validUntil: string;
};

export type QuoteStatus = {
  code: string;
  label: string;
  message: string;
  blocking: boolean;
  connectionRequired: boolean;
  closedSession?: ClosedSessionBasis;
};
export function quoteStatus(input: {
  source: string;
  asOf?: string | null;
  hasQuote: boolean;
  configured?: boolean;
  sampleSupported?: boolean;
  symbol: string;
  refreshFailed?: boolean;
  staleSeconds?: number;
  now?: number;
}): QuoteStatus {
  const status = (
    code: string,
    label: string,
    message: string,
    blocking = false,
    connectionRequired = false,
  ) => ({ code, label, message, blocking, connectionRequired });
  if (input.source === "demo") {
    if (input.sampleSupported === false || !input.hasQuote)
      return status(
        "DEMO_UNAVAILABLE",
        "Not in the sample dataset",
        input.symbol +
          " is not in the illustrative dataset. Try PL, TSLA, AAPL, SPY, or BTG; you can explore stocks and options without authorizing a brokerage.",
        true,
        true,
      );
    return status(
      "SAMPLE",
      "Sample prices only",
      "Illustrative fixtures, not current market prices. You can explore simulated portfolios without a brokerage connection.",
      false,
      true,
    );
  }
  if (input.configured === false)
    return status(
      "NOT_CONFIGURED",
      "Market data is not connected",
      input.source.startsWith("schwab-")
        ? "Schwab app credentials and brokerage authorization are separate. Live access has not been authorized locally. Sample mode remains usable without linking a brokerage; review the connection in Settings when you are ready."
        : "The selected provider's API credentials are missing. Connect the feed in Data & assumptions and restart the local app.",
      true,
      true,
    );
  if (input.refreshFailed)
    return status(
      "REFRESH_FAILED",
      "Provider refresh unavailable",
      "No fresh quote was returned. Check credentials, entitlements, rate limits, and connectivity. Any displayed price is the last cached quote; it cannot authorize a fill.",
      true,
      true,
    );
  if (!input.hasQuote)
    return status(
      "NO_QUOTE",
      "No quote returned",
      "The provider returned no quote for this instrument. Check the symbol or contract and your market-data access. No price has been invented.",
      true,
    );
  if (/delayed|indicative/.test(input.source))
    return status(
      "DELAYED",
      input.source.startsWith("schwab-") && input.source.endsWith("-indicative")
        ? "Real-time status unconfirmed"
        : "Delayed or indicative feed",
      input.source.startsWith("schwab-") && input.source.endsWith("-indicative")
        ? "Schwab did not confirm real-time status for this quote. Simulated fills are blocked until a timestamped real-time quote is returned."
        : "These prices are not executable real-time quotes. A real-time entitlement is required for simulated market fills.",
      true,
      true,
    );
  const age = (input.now ?? Date.now()) - new Date(input.asOf ?? "").getTime();
  if (
    !Number.isFinite(age) ||
    age < -5000 ||
    age > (input.staleSeconds ?? 120) * 1000
  )
    return status(
      "STALE",
      "Stale / market may be closed",
      "Showing the last provider timestamp, not a live tick. Closed markets, holidays, illiquidity, or feed outages can cause this. Orders need a fresh quote.",
      true,
    );
  if (input.source === "alpaca-iex")
    return status(
      "PARTIAL_FEED",
      "IEX exchange only",
      "This is a single-exchange quote, not the consolidated U.S. market. Use the SIP feed for consolidated stock quotes.",
      false,
      true,
    );
  return status(
    "PROVIDER_QUOTE",
    "Timestamped provider quote",
    "Prices refresh periodically. Execution independently requests a fresh bid/ask quote; this is not tick-by-tick streaming.",
  );
}
