import { AssetClass, OptionRight } from "@prisma/client";
import { blackScholesPrice } from "@/server/domain/black-scholes";
import { MarketQuote } from "@/server/domain/types";
import {
  EquityDataProvider,
  OptionsDataProvider,
  FundamentalsProvider,
  OptionContract,
} from "./interfaces";
// Illustrative fixtures, never presented as real market prices or fundamentals.
export const sampleSymbols = [
  {
    symbol: "TSLA",
    name: "Tesla, Inc.",
    exchange: "NASDAQ",
    price: 320,
    shares: 3_200_000_000,
  },
  {
    symbol: "BTG",
    name: "B2Gold Corp.",
    exchange: "NYSE American",
    price: 5.06,
    shares: 1_350_000_000,
  },
  {
    symbol: "AAPL",
    name: "Apple Inc.",
    exchange: "NASDAQ",
    price: 230,
    shares: 15_000_000_000,
  },
  {
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    exchange: "NASDAQ",
    price: 140,
    shares: 24_000_000_000,
  },
  {
    symbol: "MSFT",
    name: "Microsoft Corporation",
    exchange: "NASDAQ",
    price: 440,
    shares: 7_400_000_000,
  },
  {
    symbol: "AMZN",
    name: "Amazon.com, Inc.",
    exchange: "NASDAQ",
    price: 220,
    shares: 10_700_000_000,
  },
  {
    symbol: "GOOGL",
    name: "Alphabet Inc.",
    exchange: "NASDAQ",
    price: 190,
    shares: 12_000_000_000,
  },
  {
    symbol: "JPM",
    name: "JPMorgan Chase & Co.",
    exchange: "NYSE",
    price: 270,
    shares: 2_800_000_000,
  },
  {
    symbol: "V",
    name: "Visa Inc.",
    exchange: "NYSE",
    price: 350,
    shares: 1_800_000_000,
  },
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF Trust",
    exchange: "NYSE Arca",
    price: 600,
    shares: 0,
  },
  {
    symbol: "QQQ",
    name: "Invesco QQQ Trust",
    exchange: "NASDAQ",
    price: 530,
    shares: 0,
  },
  {
    symbol: "VOO",
    name: "Vanguard S&P 500 ETF",
    exchange: "NYSE Arca",
    price: 550,
    shares: 0,
  },
];
const cents = (n: number) => Math.round(n * 100) / 100;
export function decodeContract(symbol: string) {
  const m = /^([A-Z][A-Z0-9.]{0,9})(\d{6})([CP])(\d{8})$/.exec(symbol);
  if (!m) throw new Error("Invalid standard option contract symbol.");
  return {
    underlying: m[1],
    expiration: new Date(
      `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4, 6)}T20:00:00.000Z`,
    ),
    right: m[3] === "C" ? OptionRight.CALL : OptionRight.PUT,
    strike: Number(m[4]) / 1000,
  };
}
export class DemoEquityProvider implements EquityDataProvider {
  async getQuote(symbol: string): Promise<MarketQuote | null> {
    const item = sampleSymbols.find((x) => x.symbol === symbol);
    if (!item) return null;
    const spread = item.price < 10 ? 0.02 : 0.1;
    return {
      symbol,
      assetClass: AssetClass.EQUITY,
      bid: cents(item.price - spread / 2),
      ask: cents(item.price + spread / 2),
      last: item.price,
      mark: item.price,
      asOf: new Date(),
      source: "demo",
    };
  }
  async getQuotes(symbols: string[]) {
    return (await Promise.all(symbols.map((s) => this.getQuote(s)))).filter(
      (q): q is MarketQuote => q !== null,
    );
  }
  async subscribe(symbols: string[], onQuote: (q: MarketQuote) => void) {
    const t = setInterval(() => {
      void this.getQuotes(symbols).then((q) => q.forEach(onQuote));
    }, 15000);
    return () => clearInterval(t);
  }
}
export class DemoOptionsProvider implements OptionsDataProvider {
  async getExpirations(underlying: string) {
    if (!sampleSymbols.some((x) => x.symbol === underlying)) return [];
    return [1, 3, 6, 12, 24].map((month) => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + month);
      d.setUTCDate(15 + ((5 - d.getUTCDay() + 7) % 7));
      return d.toISOString().slice(0, 10);
    });
  }
  async getOptionQuote(symbol: string): Promise<OptionContract | null> {
    let c;
    try {
      c = decodeContract(symbol);
    } catch {
      return null;
    }
    const stock = sampleSymbols.find((x) => x.symbol === c.underlying);
    if (!stock) return null;
    const years = Math.max(
      0,
      (c.expiration.getTime() - Date.now()) / (365 * 86400000),
    );
    const iv = c.underlying === "BTG" ? 0.65 : 0.4;
    let mark = cents(
      blackScholesPrice({
        spot: stock.price,
        strike: c.strike,
        timeToExpiryYears: years,
        riskFreeRate: 0.04,
        volatility: iv,
        isCall: c.right === "CALL",
      }),
    );
    if (
      c.underlying === "BTG" &&
      c.right === "CALL" &&
      c.strike === 5 &&
      years > 0
    )
      mark = 1.82;
    return {
      ...c,
      contractSymbol: symbol,
      bid: Math.max(0, cents(mark - 0.01)),
      ask: cents(mark + 0.01),
      mark,
      last: mark,
      impliedVolatility: iv,
      asOf: new Date(),
      source: "demo",
      multiplier: 100,
    };
  }
  async getOptionChain(underlying: string, expiration: string) {
    if (!(await this.getExpirations(underlying)).includes(expiration))
      return [];
    const stock = sampleSymbols.find((x) => x.symbol === underlying);
    if (!stock) return [];
    const step = stock.price < 10 ? 0.5 : stock.price < 200 ? 5 : 10;
    const center = Math.round(stock.price / step) * step;
    const symbols = Array.from({ length: 13 }, (_, i) =>
      Math.max(step, center + (i - 6) * step),
    ).flatMap((strike) =>
      ["C", "P"].map(
        (right) =>
          `${underlying}${expiration.replaceAll("-", "").slice(2)}${right}${String(Math.round(strike * 1000)).padStart(8, "0")}`,
      ),
    );
    return (
      await Promise.all(
        [...new Set(symbols)].map((s) => this.getOptionQuote(s)),
      )
    ).filter((c): c is OptionContract => c !== null);
  }
}
export class DemoFundamentalsProvider implements FundamentalsProvider {
  async getSharesOutstanding(symbol: string) {
    return sampleSymbols.find((x) => x.symbol === symbol)?.shares || null;
  }
}
