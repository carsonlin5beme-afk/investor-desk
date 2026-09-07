import { env } from "@/lib/env";
import { FundamentalsProvider } from "./interfaces";
import { providerRequest } from "./request";
export class AlphaVantageFundamentalsProvider implements FundamentalsProvider {
  async getSharesOutstanding(symbol: string) {
    if (!env.ALPHAVANTAGE_API_KEY) return null;
    const params = new URLSearchParams({
      function: "OVERVIEW",
      symbol,
      apikey: env.ALPHAVANTAGE_API_KEY,
    });
    const data = await providerRequest<{ SharesOutstanding?: string }>(
      "Alpha Vantage",
      `${env.ALPHAVANTAGE_BASE_URL}/query?${params}`,
      {},
      6 * 3600000,
    );
    const n = Number(data.SharesOutstanding);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
}
