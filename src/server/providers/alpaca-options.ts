import { OptionRight } from "@prisma/client";
import { resolveOptionExpiry } from "@/lib/option-expiration";
import {
  alpacaConfigured,
  alpacaGet,
  finitePrice,
  midpoint,
  quoteTime,
} from "./alpaca-client";
import { OptionContract, OptionsDataProvider } from "./interfaces";

type ContractRecord = {
  symbol: string;
  underlying_symbol: string;
  root_symbol: string;
  type: "call" | "put";
  strike_price: string;
  expiration_date: string;
  size: string;
  status: string;
};
type Snapshot = {
  latestQuote?: { bp?: number; ap?: number; t?: string };
  latestTrade?: { p?: number; t?: string };
  impliedVolatility?: number;
};
type ContractPage = {
  option_contracts?: ContractRecord[];
  next_page_token?: string | null;
};
type SnapshotPage = {
  snapshots?: Record<string, Snapshot>;
  next_page_token?: string | null;
};

export function parseAlpacaOption(
  meta: ContractRecord,
  snapshot: Snapshot = {},
): OptionContract {
  const bid = finitePrice(snapshot.latestQuote?.bp),
    ask = finitePrice(snapshot.latestQuote?.ap);
  return {
    contractSymbol: meta.symbol,
    underlying: meta.underlying_symbol,
    right: meta.type === "put" ? OptionRight.PUT : OptionRight.CALL,
    strike: Number(meta.strike_price),
    expiration: resolveOptionExpiry(
      meta.expiration_date,
      meta.underlying_symbol,
    ).modelExpirationAt,
    multiplier: Number(meta.size),
    bid,
    ask,
    last: finitePrice(snapshot.latestTrade?.p),
    mark: midpoint(bid, ask),
    asOf: quoteTime(snapshot.latestQuote?.t),
    source: "alpaca-opra",
    impliedVolatility: finitePrice(snapshot.impliedVolatility),
  };
}
function standard(meta: ContractRecord) {
  return (
    meta.status === "active" &&
    Number(meta.size) === 100 &&
    meta.root_symbol === meta.underlying_symbol
  );
}
export class AlpacaOptionsProvider implements OptionsDataProvider {
  private async contracts(underlying: string, expiration?: string) {
    if (!alpacaConfigured()) return [];
    const records: ContractRecord[] = [],
      seen = new Set<string>();
    let page: string | undefined;
    do {
      const result: ContractPage = await alpacaGet<ContractPage>(
        "/v2/options/contracts",
        {
          underlying_symbols: underlying,
          status: "active",
          limit: "10000",
          // Override Alpaca's default next-weekend cutoff so LEAPS are discoverable.
          expiration_date_lte: "2100-01-01",
          ...(expiration ? { expiration_date: expiration } : {}),
          ...(page ? { page_token: page } : {}),
        },
        true,
        3600000,
      );
      records.push(...(result.option_contracts ?? []));
      page = result.next_page_token || undefined;
      if (page && (seen.has(page) || seen.size >= 100))
        throw new Error("Alpaca: incomplete contract pagination; retry later.");
      if (page) seen.add(page);
    } while (page);
    return records.filter(standard);
  }
  async getExpirations(underlying: string): Promise<string[]> {
    const contracts = await this.contracts(underlying);
    return [...new Set(contracts.map((c) => c.expiration_date))].sort();
  }
  async getOptionQuote(symbol: string): Promise<OptionContract | null> {
    if (!alpacaConfigured()) return null;
    const meta = await alpacaGet<ContractRecord>(
      `/v2/options/contracts/${encodeURIComponent(symbol)}`,
      {},
      true,
      3600000,
    );
    if (!standard(meta)) return null;
    const result = await alpacaGet<SnapshotPage>("/v1beta1/options/snapshots", {
      symbols: symbol,
      feed: "opra",
    });
    const snapshot = result.snapshots?.[symbol];
    return snapshot ? parseAlpacaOption(meta, snapshot) : null;
  }
  async getOptionChain(
    underlying: string,
    expiration: string,
  ): Promise<OptionContract[]> {
    const contracts = await this.contracts(underlying, expiration);
    if (!contracts.length) return [];
    const snapshots: Record<string, Snapshot> = {},
      seen = new Set<string>();
    let page: string | undefined;
    do {
      const result: SnapshotPage = await alpacaGet<SnapshotPage>(
        `/v1beta1/options/snapshots/${encodeURIComponent(underlying)}`,
        {
          feed: "opra",
          expiration_date: expiration,
          limit: "1000",
          ...(page ? { page_token: page } : {}),
        },
        false,
        15000,
      );
      Object.assign(snapshots, result.snapshots);
      page = result.next_page_token || undefined;
      if (page && (seen.has(page) || seen.size >= 100))
        throw new Error("Alpaca: incomplete snapshot pagination; retry later.");
      if (page) seen.add(page);
    } while (page);
    return contracts.map((c) => parseAlpacaOption(c, snapshots[c.symbol]));
  }
}
