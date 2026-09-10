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
const parseContract = (raw: any): OptionContract => {
  const right = raw.option_type === "put" ? OptionRight.PUT : OptionRight.CALL;
  const bid = price(raw.bid);
  const ask = price(raw.ask);
  return {
    contractSymbol: String(raw.symbol),
    multiplier: Number(raw.contract_size ?? 100),
    source: env.TRADIER_BASE_URL.includes("sandbox")
      ? "tradier-delayed"
      : "tradier",
    asOf: timestamp(raw.bid_date, raw.ask_date),
    underlying: String(raw.root_symbol ?? raw.underlying ?? ""),
    right,
    strike: Number(raw.strike),
    expiration: new Date(`${raw.expiration_date}T20:00:00.000Z`),
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
