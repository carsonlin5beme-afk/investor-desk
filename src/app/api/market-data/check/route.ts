import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import {
  alpacaConfigured,
  alpacaGet,
  quoteTime,
} from "@/server/providers/alpaca-client";
import { loadAlpacaSymbols } from "@/server/providers/alpaca-symbols";
import { TradierOptionsProvider } from "@/server/providers/tradier";
import {
  SchwabEquityProvider,
  SchwabOptionsProvider,
} from "@/server/providers/schwab";
import { schwabStatus } from "@/server/providers/schwab-client";
import { schwabQuoteCheck } from "@/server/services/schwab-check";
export const dynamic = "force-dynamic";
type Check = { name: string; status: string; detail: string; asOf?: string };
function timestampCheck(name: string, time: unknown): Check {
  const date = quoteTime(time),
    age = Date.now() - date.getTime();
  if (!date.getTime())
    return {
      name,
      status: "authorized_no_quote",
      detail:
        "Feed request authorized, but no timestamped quote was returned for the probe symbol.",
    };
  return {
    name,
    status:
      date.getTime() > 0 &&
      age >= -5000 &&
      age <= env.QUOTE_STALE_SECONDS * 1000
        ? "accessible_fresh"
        : "accessible_stale",
    detail:
      "Feed request authorized. Old quotes can be normal outside market hours; this is a sample-symbol check, not a coverage guarantee.",
    asOf: date.toISOString(),
  };
}
async function attempt(
  name: string,
  configured: boolean,
  run: () => Promise<Check>,
): Promise<Check> {
  if (!configured)
    return {
      name,
      status: "not_configured",
      detail:
        "Add server-side credentials to .env, then restart. Do not paste keys into chat.",
    };
  try {
    return await run();
  } catch (error) {
    return {
      name,
      status: "failed",
      detail: error instanceof Error ? error.message : "Provider unavailable",
    };
  }
}
export async function GET() {
  // Read-only probes bypass sample adapters and never touch brokerage orders or cash.
  const checks: Check[] = [];
  const authorization = schwabStatus();
  const connected =
    authorization.state === "connected" ||
    authorization.state === "refresh_due";
  if (env.EQUITY_PROVIDER === "schwab" || env.OPTIONS_PROVIDER === "schwab")
    checks.push({
      name: "Schwab local authorization",
      status: authorization.state,
      detail: authorization.detail,
    });
  if (env.EQUITY_PROVIDER === "schwab") {
    if (connected) {
      try {
        const quotes = await new SchwabEquityProvider().getQuotes([
          "AAPL",
          "SPY",
        ]);
        for (const symbol of ["AAPL", "SPY"])
          checks.push(
            schwabQuoteCheck(
              `Schwab ${symbol} ${symbol === "SPY" ? "ETF" : "stock"} quotes`,
              quotes.find((quote) => quote.symbol === symbol),
            ),
          );
      } catch (error) {
        checks.push({
          name: "Schwab stock/ETF quotes",
          status: "failed",
          detail:
            error instanceof Error && error.message.startsWith("Schwab:")
              ? error.message
              : "Schwab: market-data check failed.",
        });
      }
    }
  } else {
    checks.push(
      await attempt(
        "U.S. stock/ETF directory",
        alpacaConfigured(),
        async () => {
          const symbols = await loadAlpacaSymbols();
          return {
            name: "U.S. stock/ETF directory",
            status: symbols.length ? "accessible" : "empty",
            detail: `${symbols.length} active non-OTC U.S. equities/ETFs returned by Alpaca.`,
          };
        },
      ),
    );
    const stockCheckName = `Alpaca ${env.ALPACA_FEED.toUpperCase()} stock quotes`;
    checks.push(
      await attempt(stockCheckName, alpacaConfigured(), async () => {
        const result = await alpacaGet<{
          quotes?: Record<string, { t?: string }>;
        }>(
          "/v2/stocks/quotes/latest",
          { symbols: "SPY", feed: env.ALPACA_FEED },
          false,
          15000,
        );
        return timestampCheck(stockCheckName, result.quotes?.SPY?.t);
      }),
    );
  }
  if (env.OPTIONS_PROVIDER === "schwab") {
    if (connected)
      checks.push(
        await attempt("Schwab SPY standard option quotes", true, async () => {
          const provider = new SchwabOptionsProvider();
          const dates = await provider.getExpirations("SPY");
          if (!dates.length)
            return {
              name: "Schwab SPY standard option quotes",
              status: "empty",
              detail:
                "No future SPY expirations returned; option coverage is unverified.",
            };
          const chain = await provider.getOptionChain("SPY", dates[0]);
          // Choose a quoted contract with the smallest relative spread for a representative probe.
          const candidate = [...chain].sort((a, b) => {
            const spread = (row: typeof a) =>
              row.bid != null &&
              row.ask != null &&
              row.bid > 0 &&
              row.ask >= row.bid
                ? (row.ask - row.bid) / row.ask
                : Infinity;
            return spread(a) - spread(b);
          })[0];
          const quote = candidate
            ? await provider.getOptionQuote(candidate.contractSymbol)
            : null;
          return schwabQuoteCheck("Schwab SPY standard option quotes", quote);
        }),
      );
  } else if (env.OPTIONS_PROVIDER === "alpaca") {
    checks.push(
      await attempt(
        "Alpaca OPRA option quotes",
        alpacaConfigured(),
        async () => {
          const result = await alpacaGet<{
            snapshots?: Record<string, { latestQuote?: { t?: string } }>;
          }>(
            "/v1beta1/options/snapshots/SPY",
            { feed: "opra", limit: "1" },
            false,
            15000,
          );
          return timestampCheck(
            "Alpaca OPRA option quotes",
            Object.values(result.snapshots ?? {})[0]?.latestQuote?.t,
          );
        },
      ),
    );
  } else {
    checks.push(
      await attempt(
        "Tradier option quotes",
        Boolean(env.TRADIER_API_TOKEN),
        async () => {
          const provider = new TradierOptionsProvider(),
            dates = await provider.getExpirations("SPY");
          if (!dates.length)
            return {
              name: "Tradier option quotes",
              status: "empty",
              detail: "No SPY expirations returned.",
            };
          const chain = await provider.getOptionChain(
            "SPY",
            [...dates].sort()[0],
          );
          const latest = chain.reduce(
            (date, q) => Math.max(date, q.asOf?.getTime() ?? 0),
            0,
          );
          if (env.TRADIER_BASE_URL.includes("sandbox"))
            return {
              name: "Tradier option quotes",
              status: "delayed",
              detail: "Sandbox data is delayed, not real-time OPRA pricing.",
            };
          return timestampCheck(
            "Tradier option quotes",
            new Date(latest).toISOString(),
          );
        },
      ),
    );
  }
  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      mode: env.MARKET_DATA_MODE,
      equityFeedConfigured:
        env.EQUITY_PROVIDER === "schwab" ? "schwab" : env.ALPACA_FEED,
      equityProvider: env.EQUITY_PROVIDER,
      optionsProvider: env.OPTIONS_PROVIDER,
      note: "Read-only market-data probes; local authorization is separate from successful quote access. All portfolios and orders remain simulated. Quotes refresh through polling, not tick-by-tick streaming. A passing probe does not grant redistribution rights.",
      checks,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
