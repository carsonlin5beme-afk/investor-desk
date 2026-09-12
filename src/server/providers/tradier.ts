import { providerRequest } from "./request";
import { OptionRight } from "@prisma/client";
import { resolveOptionExpiry } from "@/lib/option-expiration";
import { decodeContract } from "./demo";
import { isStandardOptionContract } from "./option-contract";

import { env } from "@/lib/env";
import {
  OptionsDataProvider,
  OptionContract,
} from "@/server/providers/interfaces";

const asArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
};

const price = (value: unknown): number | null => {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const timestamp = (bid: unknown, ask: unknown) => {
  const a = Number(bid),
    b = Number(ask);
  const time = Math.min(a, b);
  const date = new Date(time);
  return Number.isFinite(time) && time > 0 && Number.isFinite(date.getTime())
    ? date
    : new Date(0);
};
const parseContract = (raw: any): OptionContract | null => {
  if (
    !raw ||
    raw.type !== "option" ||
    !["call", "put"].includes(raw.option_type) ||
    Number(raw.contract_size) !== 100 ||
    !raw.underlying ||
    raw.root_symbol !== raw.underlying
  )
    return null;
  const right = raw.option_type === "put" ? OptionRight.PUT : OptionRight.CALL;
  const bid = price(raw.bid);
  const ask = price(raw.ask);
  return {
    contractSymbol: String(raw.symbol),
    multiplier: Number(raw.contract_size),
    source: env.TRADIER_BASE_URL.includes("sandbox")
      ? "tradier-delayed"
      : "tradier",
    asOf: timestamp(raw.bid_date, raw.ask_date),
    underlying: String(raw.underlying),
    right,
    strike: Number(raw.strike),
    expiration: resolveOptionExpiry(
      String(raw.expiration_date),
      String(raw.underlying),
    ).modelExpirationAt,
    bid,
    ask,
    last: price(raw.last),
    mark: bid != null && ask != null && bid <= ask ? (bid + ask) / 2 : null,
    impliedVolatility: price(raw.greeks?.mid_iv),
  };
};

export class TradierOptionsProvider implements OptionsDataProvider {
  private readonly hasToken = Boolean(env.TRADIER_API_TOKEN);

  private async get(
    path: string,
    params: Record<string, string>,
  ): Promise<any> {
    const query = new URLSearchParams(params);
    return providerRequest(
      "Tradier",
      `${env.TRADIER_BASE_URL}${path}?${query}`,
      {
        Authorization: `Bearer ${env.TRADIER_API_TOKEN ?? ""}`,
        Accept: "application/json",
      },
      path.endsWith("expirations")
        ? 3600000
        : path.endsWith("chains")
          ? 15000
          : 1000,
    );
  }

  async getOptionQuote(contractSymbol: string): Promise<OptionContract | null> {
    if (!this.hasToken) {
      return null;
    }

    let underlying: string;
    try {
      underlying = decodeContract(contractSymbol).underlying;
    } catch {
      return null;
    }
    const payload = await this.get("/markets/quotes", {
      symbols: `${contractSymbol},${underlying}`,
      greeks: "true",
    });
    const rows = asArray<any>(payload?.quotes?.quote);
    const base = rows.find((row) => row.symbol === underlying);
    if (!base || !["stock", "etf"].includes(base.type)) return null;
    const raw = rows.find((row) => row.symbol === contractSymbol);
    try {
      const contract = parseContract(raw);
      return contract && isStandardOptionContract(contractSymbol, contract)
        ? contract
        : null;
    } catch {
      return null;
    }
  }

  async getOptionChain(
    underlying: string,
    expiration: string,
  ): Promise<OptionContract[]> {
    if (!this.hasToken) {
      return [];
    }

    const classification = await this.get("/markets/quotes", {
      symbols: underlying,
    });
    const base = asArray<any>(classification?.quotes?.quote).find(
      (row) => row.symbol === underlying,
    );
    if (!base || !["stock", "etf"].includes(base.type)) return [];
    const payload = await this.get("/markets/options/chains", {
      symbol: underlying,
      expiration,
      greeks: "true",
    });

    return asArray(payload?.options?.option)
      .map((raw) => {
        try {
          return parseContract(raw);
        } catch {
          return null;
        }
      })
      .filter((contract): contract is OptionContract => contract !== null);
  }

  async getExpirations(underlying: string): Promise<string[]> {
    if (!this.hasToken) {
      return [];
    }

    const payload = await this.get("/markets/options/expirations", {
      symbol: underlying,
      includeAllRoots: "true",
    });
    return asArray(payload?.expirations?.date).map(String);
  }
}
