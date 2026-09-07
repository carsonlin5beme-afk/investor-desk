import { alpacaConfigured, alpacaGet } from "./alpaca-client";
import { SymbolInfo } from "./interfaces";
type Asset = {
  symbol: string;
  name: string;
  exchange: string;
  status: string;
  class: string;
};
export async function loadAlpacaSymbols(): Promise<SymbolInfo[]> {
  if (!alpacaConfigured())
    throw new Error("Alpaca asset directory requires API credentials.");
  const assets = await alpacaGet<Asset[]>(
    "/v2/assets",
    { status: "active", asset_class: "us_equity" },
    true,
    6 * 3600000,
  );
  return assets
    .filter(
      (a) =>
        a.status === "active" &&
        a.class === "us_equity" &&
        a.exchange !== "OTC",
    )
    .map(({ symbol, name, exchange }) => ({ symbol, name, exchange }));
}
