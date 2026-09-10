import { loadAlpacaSymbols } from "@/server/providers/alpaca-symbols";
import { isDemo } from "@/server/providers/factory";
import { env } from "@/lib/env";
import { SchwabEquityProvider } from "@/server/providers/schwab";
import { sampleSymbols } from "@/server/providers/demo";
import { loadAllExchangeSymbols } from "@/server/providers/sec-symbols";
import { SymbolInfo } from "@/server/providers/interfaces";

interface CachedUniverse {
  symbols: SymbolInfo[];
  loadedAt: number;
  mode: "demo" | "live";
  provider: string;
}

const CACHE_TTL_MS = 1000 * 60 * 60 * 6;

const getCacheHolder = () => {
  const key = "__investorDeskSymbolUniverse" as const;
  const scope = globalThis as typeof globalThis & {
    [key]?: CachedUniverse;
  };

  return {
    get: () => scope[key],
    set: (value: CachedUniverse) => {
      scope[key] = value;
    },
  };
};

const loadUniverse = async (): Promise<SymbolInfo[]> => {
  const holder = getCacheHolder();
  const cached = holder.get();
  const now = Date.now();

  if (
    cached &&
    cached.mode === (isDemo ? "demo" : "live") &&
    cached.provider === env.EQUITY_PROVIDER &&
    now - cached.loadedAt < CACHE_TTL_MS
  ) {
    return cached.symbols;
  }

  const symbols = isDemo
    ? sampleSymbols
    : env.EQUITY_PROVIDER === "schwab"
      ? await loadAllExchangeSymbols()
      : await loadAlpacaSymbols().catch(() => loadAllExchangeSymbols());
  holder.set({
    symbols,
    loadedAt: now,
    mode: isDemo ? "demo" : "live",
    provider: env.EQUITY_PROVIDER,
  });
  return symbols;
};

const searchScore = (symbol: string, name: string, queryUpper: string) => {
  if (symbol === queryUpper) {
    return 0;
  }
  if (symbol.startsWith(queryUpper)) {
    return 1;
  }
  if (name.startsWith(queryUpper)) {
    return 2;
  }
  if (symbol.includes(queryUpper)) {
    return 3;
  }
  if (name.includes(queryUpper)) {
    return 4;
  }
  return 10;
};

export const searchSymbols = async (
  query: string,
  limit = 12,
): Promise<SymbolInfo[]> => {
  const queryUpper = query.trim().toUpperCase();
  if (!queryUpper) {
    return [];
  }

  let universe = await (env.EQUITY_PROVIDER === "schwab" && !isDemo
    ? loadUniverse().catch(() => [] as SymbolInfo[])
    : loadUniverse());
  if (
    !isDemo &&
    env.EQUITY_PROVIDER === "schwab" &&
    /^[A-Z][A-Z0-9.\/-]{0,9}$/.test(queryUpper)
  ) {
    const quote = await new SchwabEquityProvider()
      .getQuote(queryUpper)
      .catch(() => null);
    if (quote && !universe.some((item) => item.symbol === queryUpper))
      universe = [{ symbol: queryUpper }, ...universe];
  }

  return universe
    .map((item) => {
      const symbol = item.symbol.toUpperCase();
      const name = (item.name ?? "").toUpperCase();
      return {
        item,
        score: searchScore(symbol, name, queryUpper),
      };
    })
    .filter(({ score }) => score < 10)
    .sort((a, b) => {
      if (a.score !== b.score) {
        return a.score - b.score;
      }
      return a.item.symbol.localeCompare(b.item.symbol);
    })
    .slice(0, Math.max(1, Math.min(limit, 50)))
    .map(({ item }) => item);
};
