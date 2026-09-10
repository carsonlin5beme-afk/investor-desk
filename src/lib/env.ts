import { z } from "zod";
import { developmentMarketEnv } from "@/server/config/development-market-env";

const envSchema = z.object({
  MARKET_DATA_MODE: z.enum(["demo", "live"]).default("demo"),
  EQUITY_PROVIDER: z.enum(["alpaca", "schwab"]).default("alpaca"),
  OPTIONS_PROVIDER: z.enum(["tradier", "alpaca", "schwab"]).default("tradier"),
  ALPACA_REFERENCE_BASE_URL: z
    .string()
    .url()
    .default("https://paper-api.alpaca.markets"),
  ALPACA_FEED: z.enum(["iex", "sip"]).default("iex"),
  DATABASE_URL: z
    .string()
    .url()
    .default(
      "postgresql://investor:investor@localhost:5432/investor_desk?schema=public",
    ),
  ALPACA_API_KEY: z.string().optional(),
  ALPACA_API_SECRET: z.string().optional(),
  ALPACA_DATA_BASE_URL: z.string().url().default("https://data.alpaca.markets"),
  ALPACA_WS_URL: z
    .string()
    .url()
    .default("wss://stream.data.alpaca.markets/v2/iex"),
  TRADIER_API_TOKEN: z.string().optional(),
  TRADIER_BASE_URL: z.string().url().default("https://api.tradier.com/v1"),
  ALPHAVANTAGE_API_KEY: z.string().optional(),
  ALPHAVANTAGE_BASE_URL: z
    .string()
    .url()
    .default("https://www.alphavantage.co"),
  QUOTE_STALE_SECONDS: z.coerce.number().default(120),
  OPTIONS_POLL_SECONDS: z.coerce.number().default(20),
});

const parsed = envSchema.safeParse(developmentMarketEnv(process.env));

if (!parsed.success) {
  const fields = [
    ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
  ].join(", ");
  // Zod messages can include rejected values. Report field names only.
  throw new Error(`Invalid environment configuration fields: ${fields}.`);
}

export const env = parsed.data;
