import { SymbolInfo } from "@/server/providers/interfaces";

interface SecTickerResponse {
  fields: string[];
  data: Array<Array<string | number>>;
}

const loadSecTickerPayload = async (): Promise<SecTickerResponse> => {
  const response = await fetch(
    "https://www.sec.gov/files/company_tickers_exchange.json",
    {
      headers: {
        "User-Agent": "InvestorDesk/1.0 (local development)",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    },
  );

  if (!response.ok) {
    throw new Error(`SEC ticker list failed (${response.status})`);
  }

  return (await response.json()) as SecTickerResponse;
};

const mapSymbols = (payload: SecTickerResponse): SymbolInfo[] => {
  const exchangeIdx = payload.fields.indexOf("exchange");
  const symbolIdx = payload.fields.indexOf("ticker");
  const nameIdx = payload.fields.indexOf("name");

  if (symbolIdx < 0) {
    return [];
  }

  return payload.data.map((row) => ({
    symbol: String(row[symbolIdx]),
    name: nameIdx >= 0 ? String(row[nameIdx]) : undefined,
    exchange:
      exchangeIdx >= 0 ? String(row[exchangeIdx]).toUpperCase() : undefined,
  }));
};

export const loadAllExchangeSymbols = async (): Promise<SymbolInfo[]> => {
  const payload = await loadSecTickerPayload();
  return mapSymbols(payload);
};

export const loadNyseSymbols = async (): Promise<SymbolInfo[]> => {
  const symbols = await loadAllExchangeSymbols();
  return symbols.filter((symbol) => symbol.exchange === "NYSE");
};
