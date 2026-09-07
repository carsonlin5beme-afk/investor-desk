import { providerRequest } from "./request";
import { OptionRight } from "@prisma/client";

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

const parseContract = (raw: any): OptionContract => {
  const right = raw.option_type === "put" ? OptionRight.PUT : OptionRight.CALL;
  const bid = raw.bid != null ? Number(raw.bid) : null;
  const ask = raw.ask != null ? Number(raw.ask) : null;
  return {
    contractSymbol: String(raw.symbol),
    multiplier: Number(raw.contract_size ?? 100),
    source: env.TRADIER_BASE_URL.includes("sandbox")
      ? "tradier-delayed"
      : "tradier",
    asOf: new Date(
      raw.bid_date && raw.ask_date
        ? Math.min(Number(raw.bid_date), Number(raw.ask_date))
        : 0,
    ),
    underlying: String(raw.root_symbol ?? raw.underlying ?? ""),
    right,
    strike: Number(raw.strike),
    expiration: new Date(`${raw.expiration_date}T20:00:00.000Z`),
    bid,
    ask,
    last: raw.last != null ? Number(raw.last) : null,
    mark: bid != null && ask != null ? (bid + ask) / 2 : (bid ?? ask ?? null),
    impliedVolatility:
      raw.greeks?.mid_iv != null ? Number(raw.greeks.mid_iv) : null,
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

    const payload = await this.get("/markets/quotes", {
      symbols: contractSymbol,
      greeks: "true",
    });
    const quote = payload?.quotes?.quote;
    if (!quote) {
      return null;
    }

    return parseContract(quote);
  }

  async getOptionChain(
    underlying: string,
    expiration: string,
  ): Promise<OptionContract[]> {
    if (!this.hasToken) {
      return [];
    }

    const payload = await this.get("/markets/options/chains", {
      symbol: underlying,
      expiration,
      greeks: "true",
    });

    return asArray(payload?.options?.option).map(parseContract);
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
