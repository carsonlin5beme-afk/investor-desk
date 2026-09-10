import { AssetClass, OptionRight } from "@prisma/client";
import { finitePrice, midpoint } from "./alpaca-client";
import { schwabGet } from "./schwab-client";
import type {
  EquityDataProvider,
  OptionContract,
  OptionsDataProvider,
} from "./interfaces";
import type { MarketQuote } from "@/server/domain/types";

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : {};
export function schwabTime(value: unknown): Date {
  const time =
    typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : 0;
  const date = new Date(time);
  return Number.isFinite(date.getTime()) ? date : new Date(0);
}
export function schwabSource(
  asset: "equity" | "option",
  realtime: unknown,
): string {
  return `schwab-${asset}${realtime === true ? "" : realtime === false ? "-delayed" : "-indicative"}`;
}
export function canonicalSchwabOption(value: unknown) {
  if (typeof value !== "string" || value.length > 21) return null;
  const match = /^([A-Z][A-Z.]{0,5}) *(\d{6})([CP])(\d{8})$/.exec(value);
  if (!match) return null;
  const date = `20${match[2].slice(0, 2)}-${match[2].slice(2, 4)}-${match[2].slice(4, 6)}`;
  const expiration = new Date(`${date}T20:00:00.000Z`);
  if (
    !Number.isFinite(expiration.getTime()) ||
    expiration.toISOString().slice(0, 10) !== date
  )
    return null;
  const compact = match[1] + match[2] + match[3] + match[4];
  const padded = match[1].padEnd(6, " ") + match[2] + match[3] + match[4];
  if (value !== compact && value !== padded) return null;
  return {
    symbol: match[1] + match[2] + match[3] + match[4],
    padded: match[1].padEnd(6, " ") + match[2] + match[3] + match[4],
    underlying: match[1],
    right: match[3] === "C" ? OptionRight.CALL : OptionRight.PUT,
    strike: Number(match[4]) / 1000,
    date,
    expiration,
  };
}
export function parseSchwabEquity(
  symbol: string,
  input: unknown,
): MarketQuote | null {
  const raw = record(input),
    q = record(raw.quote);
  if (raw.symbol !== symbol || raw.assetMainType !== "EQUITY") return null;
  const bid = finitePrice(q.bidPrice),
    ask = finitePrice(q.askPrice);
  return {
    symbol,
    assetClass: AssetClass.EQUITY,
    bid,
    ask,
    last: finitePrice(q.lastPrice),
    mark: midpoint(bid, ask),
    source: schwabSource("equity", raw.realtime),
    asOf: schwabTime(q.quoteTime),
  };
}
export class SchwabEquityProvider implements EquityDataProvider {
  async getQuote(symbol: string): Promise<MarketQuote | null> {
    return (await this.getQuotes([symbol]))[0] ?? null;
  }
  async getQuotes(symbols: string[]): Promise<MarketQuote[]> {
    const unique = [...new Set(symbols)];
    if (!unique.length) return [];
    const quotes: MarketQuote[] = [];
    for (let offset = 0; offset < unique.length; offset += 100) {
      const batch = unique.slice(offset, offset + 100);
      const result = record(
        await schwabGet("/quotes", {
          symbols: batch.join(","),
          fields: "quote",
          indicative: "false",
        }),
      );
      for (const symbol of batch) {
        const quote = parseSchwabEquity(symbol, result[symbol]);
        if (quote) quotes.push(quote);
      }
    }
    return quotes;
  }
  async subscribe(
    symbols: string[],
    onQuote: (q: MarketQuote) => void,
    onError?: (error: Error) => void,
  ) {
    let closed = false,
      busy = false;
    const poll = async () => {
      if (closed || busy) return;
      busy = true;
      try {
        const quotes = await this.getQuotes(symbols);
        if (!closed) quotes.forEach(onQuote);
      } catch (error) {
        if (!closed)
          onError?.(
            error instanceof Error ? error : new Error("Schwab unavailable"),
          );
      } finally {
        busy = false;
      }
    };
    await poll();
    const timer = setInterval(poll, 15000);
    return () => {
      closed = true;
      clearInterval(timer);
    };
  }
}
// Schwab volatility units are not established by the official schema; use the
// app's visibly labeled IV assumption instead of silently guessing a conversion.
export function parseSchwabChainContract(
  input: unknown,
  underlying: string,
  expiration: string,
  delayed: unknown,
): OptionContract | null {
  const raw = record(input),
    meta = canonicalSchwabOption(raw.symbol);
  if (
    !meta ||
    meta.underlying !== underlying ||
    meta.date !== expiration ||
    raw.putCall !== meta.right ||
    raw.strikePrice !== meta.strike ||
    raw.multiplier !== 100 ||
    raw.isNonStandard !== false ||
    raw.isMini !== false ||
    raw.isIndexOption !== false
  )
    return null;
  // Reject alternate deliverables even if a contradictory standard flag is present.
  if (
    (raw.deliverableNote != null && raw.deliverableNote !== "") ||
    (raw.optionRoot != null && raw.optionRoot !== meta.underlying)
  )
    return null;
  const deliverables = raw.optionDeliverablesList;
  if (
    deliverables != null &&
    (!Array.isArray(deliverables) || deliverables.length > 0)
  )
    return null;
  const statedExpiration =
    typeof raw.expirationDate === "string"
      ? raw.expirationDate.slice(0, 10)
      : schwabTime(raw.expirationDate).toISOString().slice(0, 10);
  if (statedExpiration !== meta.date) return null;
  const bid = finitePrice(raw.bidPrice),
    ask = finitePrice(raw.askPrice);
  return {
    contractSymbol: meta.symbol,
    underlying,
    right: meta.right,
    strike: meta.strike,
    expiration: meta.expiration,
    multiplier: 100,
    bid,
    ask,
    last: finitePrice(raw.lastPrice),
    mark: midpoint(bid, ask),
    asOf: schwabTime(raw.quoteTimeInLong),
    source: schwabSource(
      "option",
      delayed === false ? true : delayed === true ? false : undefined,
    ),
    impliedVolatility: null,
  };
}
export class SchwabOptionsProvider implements OptionsDataProvider {
  async getExpirations(underlying: string): Promise<string[]> {
    const result = record(
      await schwabGet("/expirationchain", { symbol: underlying }),
    );
    if (result.status && result.status !== "SUCCESS")
      throw new Error("Schwab: option expiration lookup was unsuccessful.");
    const list = Array.isArray(result.expirationList)
      ? result.expirationList
      : [];
    return [
      ...new Set(
        list
          .map((item) => {
            const raw = record(item);
            if (
              raw.expirationDate != null &&
              raw.expiration != null &&
              raw.expirationDate !== raw.expiration
            )
              return null;
            return raw.expirationDate ?? raw.expiration;
          })
          .filter(
            (date): date is string =>
              typeof date === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(date) &&
              Number.isFinite(new Date(`${date}T20:00:00Z`).getTime()) &&
              new Date(`${date}T20:00:00Z`).toISOString().slice(0, 10) ===
                date &&
              new Date(`${date}T20:00:00Z`).getTime() > Date.now(),
          ),
      ),
    ].sort();
  }
  async getOptionChain(
    underlying: string,
    expiration: string,
  ): Promise<OptionContract[]> {
    const result = record(
      await schwabGet("/chains", {
        symbol: underlying,
        contractType: "ALL",
        strategy: "SINGLE",
        fromDate: expiration,
        toDate: expiration,
        includeUnderlyingQuote: "true",
        optionType: "S",
      }),
    );
    if (result.symbol !== underlying || result.status !== "SUCCESS")
      throw new Error(
        "Schwab: option chain was unavailable or did not match the symbol.",
      );
    // This simulator models deliverable equity/ETF options, never cash-settled indexes.
    if (
      result.isIndex !== false ||
      record(result.underlying).symbol !== underlying
    )
      throw new Error(
        "Schwab: standard equity/ETF option metadata is unavailable or unsupported.",
      );
    const contracts = new Map<string, OptionContract>();
    for (const map of [
      record(result.callExpDateMap),
      record(result.putExpDateMap),
    ]) {
      for (const [date, strikes] of Object.entries(map)) {
        if (date.split(":")[0] !== expiration) continue;
        for (const rows of Object.values(record(strikes))) {
          for (const raw of Array.isArray(rows) ? rows : []) {
            const parsed = parseSchwabChainContract(
              raw,
              underlying,
              expiration,
              result.isDelayed,
            );
            if (parsed) contracts.set(parsed.contractSymbol, parsed);
          }
        }
      }
    }
    if (!contracts.size)
      throw new Error(
        "Schwab: no supported standard 100-share contracts returned; contract metadata may be incomplete or unsupported.",
      );
    return [...contracts.values()];
  }
  async getOptionQuote(symbol: string): Promise<OptionContract | null> {
    const meta = canonicalSchwabOption(symbol);
    if (!meta || meta.symbol !== symbol) return null;
    const chain = await this.getOptionChain(meta.underlying, meta.date);
    const contract = chain.find((row) => row.contractSymbol === symbol);
    if (!contract) return null;
    const result = record(
      await schwabGet("/quotes", {
        symbols: meta.padded,
        fields: "quote,reference",
        indicative: "false",
      }),
    );
    const matches = Object.entries(result).filter(
      ([key, value]) =>
        canonicalSchwabOption(key)?.symbol === symbol &&
        canonicalSchwabOption(record(value).symbol)?.symbol === symbol,
    );
    if (matches.length !== 1) return null;
    const raw = record(matches[0][1]),
      quote = record(raw.quote);
    if (raw.assetMainType !== "OPTION") return null;
    const reference = record(raw.reference);
    if (
      reference.multiplier !== 100 ||
      reference.strikePrice !== meta.strike ||
      reference.contractType !== (meta.right === "CALL" ? "C" : "P") ||
      reference.underlying !== meta.underlying ||
      reference.expirationYear !== Number(meta.date.slice(0, 4)) ||
      reference.expirationMonth !== Number(meta.date.slice(5, 7)) ||
      reference.expirationDay !== Number(meta.date.slice(8, 10)) ||
      (reference.deliverables != null && reference.deliverables !== "")
    )
      return null;
    const bid = finitePrice(quote.bidPrice),
      ask = finitePrice(quote.askPrice);
    return {
      ...contract,
      bid,
      ask,
      last: finitePrice(quote.lastPrice),
      mark: midpoint(bid, ask),
      asOf: schwabTime(quote.quoteTime),
      source: schwabSource("option", raw.realtime),
      impliedVolatility: null,
    };
  }
}
