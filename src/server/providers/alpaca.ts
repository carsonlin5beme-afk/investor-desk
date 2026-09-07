import { alpacaGet, finitePrice, midpoint, quoteTime } from "./alpaca-client";
import { AssetClass } from "@prisma/client";

import { env } from "@/lib/env";
import { MarketQuote } from "@/server/domain/types";
import { EquityDataProvider } from "@/server/providers/interfaces";

export const parseAlpacaEquityQuote = (
  symbol: string,
  payload: { bp?: number; ap?: number; t?: string },
): MarketQuote => {
  const bid = finitePrice(payload?.bp),
    ask = finitePrice(payload?.ap);
  return {
    symbol,
    assetClass: AssetClass.EQUITY,
    bid,
    ask,
    last: null,
    mark: midpoint(bid, ask),
    source: `alpaca-${env.ALPACA_FEED}`,
    asOf: quoteTime(payload?.t),
  };
};

export class AlpacaEquityProvider implements EquityDataProvider {
  private readonly hasCreds = Boolean(
    env.ALPACA_API_KEY && env.ALPACA_API_SECRET,
  );

  async getQuote(symbol: string): Promise<MarketQuote | null> {
    const quotes = await this.getQuotes([symbol]);
    return quotes[0] ?? null;
  }

  async getQuotes(symbols: string[]): Promise<MarketQuote[]> {
    if (!this.hasCreds || symbols.length === 0) {
      return [];
    }

    const data = await alpacaGet<{
      quotes?: Record<string, { bp?: number; ap?: number; t?: string }>;
    }>("/v2/stocks/quotes/latest", {
      symbols: symbols.join(","),
      feed: env.ALPACA_FEED,
    });
    return Object.entries(data.quotes ?? {}).map(([symbol, payload]) =>
      parseAlpacaEquityQuote(symbol, payload),
    );
  }

  async subscribe(
    symbols: string[],
    onQuote: (quote: MarketQuote) => void,
    onError?: (error: Error) => void,
  ): Promise<() => void> {
    if (!this.hasCreds || symbols.length === 0) {
      return () => undefined;
    }

    let closed = false;
    let stopPolling: NodeJS.Timeout | null = null;
    let ws: WebSocket | null = null;

    const cleanup = () => {
      closed = true;
      if (stopPolling) {
        clearInterval(stopPolling);
      }
      if (ws) {
        ws.close();
      }
    };

    const canUseSocket = typeof WebSocket !== "undefined";

    if (canUseSocket) {
      try {
        ws = new WebSocket(env.ALPACA_WS_URL);

        ws.onopen = () => {
          ws?.send(
            JSON.stringify({
              action: "auth",
              key: env.ALPACA_API_KEY,
              secret: env.ALPACA_API_SECRET,
            }),
          );
          ws?.send(JSON.stringify({ action: "subscribe", quotes: symbols }));
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data as string) as Array<any>;
            for (const message of payload) {
              if (message.T === "q" && message.S) {
                onQuote(
                  parseAlpacaEquityQuote(message.S, {
                    bp: message.bp,
                    ap: message.ap,
                    t: message.t,
                  }),
                );
              }
            }
          } catch (error) {
            onError?.(error as Error);
          }
        };

        ws.onerror = () => {
          if (!closed) {
            onError?.(
              new Error("Alpaca websocket error; falling back to polling."),
            );
          }
        };

        ws.onclose = () => {
          if (!closed) {
            stopPolling = setInterval(async () => {
              try {
                const quotes = await this.getQuotes(symbols);
                quotes.forEach(onQuote);
              } catch (error) {
                onError?.(error as Error);
              }
            }, 5000);
          }
        };

        return cleanup;
      } catch (error) {
        onError?.(error as Error);
      }
    }

    stopPolling = setInterval(async () => {
      try {
        const quotes = await this.getQuotes(symbols);
        quotes.forEach(onQuote);
      } catch (error) {
        onError?.(error as Error);
      }
    }, 5000);

    return cleanup;
  }
}
