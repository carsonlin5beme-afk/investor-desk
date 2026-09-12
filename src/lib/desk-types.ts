export type Projection = {
  currentMarketValue: number;
  currentPrice: number | null;
  costBasis: number;
  unrealizedPnL: number;
  targetUnderlyingPrice: number | null;
  projectedValue: number;
  optionIntrinsicProjectedValue: number | null;
  optionModelProjectedValue: number | null;
  hasTarget: boolean;
  priceEstimated: boolean;
  valuationBasis?: "COST_BASIS" | "OPTION_MIDPOINT" | "MARK";
  quoteStale: boolean;
  quoteAsOf: string | null;
  quoteSource: string;
  impliedVolatility: number | null;
  ivEstimated: boolean;
  underlyingPrice: number | null;
  expired: boolean;
  expirationAssumed?: boolean;
  expirationPolicy?: string | null;
};
export type Holding = {
  id: string;
  portfolioId: string;
  symbol: string;
  assetClass: "EQUITY" | "OPTION";
  quantity: number;
  avgCost: number;
  optionDetails: null | {
    underlying: string;
    optionSymbol: string;
    right: "CALL" | "PUT";
    strike: string;
    expiration: string;
    multiplier: number;
  };
  targetScenario: null | {
    targetMode: "PRICE" | "MARKET_CAP";
    targetPrice: string | null;
    targetMarketCap: string | null;
    sharesOutstandingLive: string | null;
    sharesOutstandingManual: string | null;
    useManualShares: boolean;
  };
  projection: Projection;
};
export type Portfolio = {
  id: string;
  name: string;
  cashBalance: number;
  startingCash: number;
  currentValue: number;
  equitiesValue: number;
  optionsValue: number;
  projectedNetWorth: number;
  intrinsicNetWorth: number;
  targetCount: number;
  estimatedCount: number;
  positions: Holding[];
  orders: {
    id: string;
    side: string;
    assetClass: string;
    symbol: string;
    optionContractSymbol: string | null;
    quantity: string;
    submittedAt: string;
    quoteSource: string;
    fills: { price: string; realizedPnL: string }[];
  }[];
  ledger: {
    id: string;
    type: string;
    amount: string;
    note: string;
    createdAt: string;
  }[];
};
export type DeskData = {
  guest?: { temporary: boolean; expired: boolean; expiresAt: string | null };
  pendingGuest?: {
    portfolioCount: number;
    entryCount: number;
    expiresAt: string | null;
    expired: boolean;
  } | null;
  user: { id: string; name: string; email: string } | null;
  portfolios: Portfolio[];
  mode: "demo" | "live";
  feeds: {
    equities: boolean;
    options: boolean;
    fundamentals: boolean;
    equityFeed: string;
  };
  asOf: string;
};
export type Contract = {
  source?: string;
  asOf?: string | null;
  stale?: boolean;
  contractSymbol: string;
  underlying: string;
  right: "CALL" | "PUT";
  strike: number;
  expiration: string;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  impliedVolatility: number | null;
};
export const money = (n: number | null | undefined, decimals = 2) =>
  n == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(n);
export const compact = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
export const num = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(n);
export async function api<T = Record<string, unknown>>(
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await r.json();
  if (!r.ok) {
    const fields = data.details?.fieldErrors;
    throw new Error(
      fields
        ? Object.values(fields).flat().join(" ")
        : (data.error ?? "Request failed."),
    );
  }
  return data;
}
