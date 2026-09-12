import { AssetClass, OptionRight } from "@prisma/client";

import { MarketQuote } from "@/server/domain/types";

export interface SymbolInfo {
  symbol: string;
  name?: string;
  exchange?: string;
}

export interface OptionContract {
  asOf?: Date;
  source?: string;
  multiplier?: number;
  contractSymbol: string;
  underlying: string;
  right: OptionRight;
  strike: number;
  expiration: Date;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  impliedVolatility: number | null;
}

export interface EquityDataProvider {
  getQuote(
    symbol: string,
    options?: { forceRefresh?: boolean },
  ): Promise<MarketQuote | null>;
  getQuotes(
    symbols: string[],
    options?: { forceRefresh?: boolean },
  ): Promise<MarketQuote[]>;
  subscribe(
    symbols: string[],
    onQuote: (quote: MarketQuote) => void,
    onError?: (error: Error) => void,
  ): Promise<() => void>;
}

export interface OptionsDataProvider {
  getOptionQuote(contractSymbol: string): Promise<OptionContract | null>;
  getOptionChain(
    underlying: string,
    expiration: string,
  ): Promise<OptionContract[]>;
  getExpirations(underlying: string): Promise<string[]>;
}

export interface FundamentalsProvider {
  getSharesOutstanding(symbol: string): Promise<number | null>;
}

export interface QuotePublisher {
  publish(quote: {
    symbol: string;
    assetClass: AssetClass;
    bid: number | null;
    ask: number | null;
    last: number | null;
    mark: number | null;
    source: string;
    asOf: Date;
  }): Promise<void>;
}
