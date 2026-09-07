import { env } from "@/lib/env";
import { AlpacaEquityProvider } from "./alpaca";
import { AlphaVantageFundamentalsProvider } from "./alphavantage";
import { AlpacaOptionsProvider } from "./alpaca-options";
import { TradierOptionsProvider } from "./tradier";
import {
  DemoEquityProvider,
  DemoOptionsProvider,
  DemoFundamentalsProvider,
} from "./demo";
export const isDemo = env.MARKET_DATA_MODE === "demo";
export const providers = {
  equities: isDemo ? new DemoEquityProvider() : new AlpacaEquityProvider(),
  options: isDemo
    ? new DemoOptionsProvider()
    : env.OPTIONS_PROVIDER === "alpaca"
      ? new AlpacaOptionsProvider()
      : new TradierOptionsProvider(),
  fundamentals: isDemo
    ? new DemoFundamentalsProvider()
    : new AlphaVantageFundamentalsProvider(),
};

export const quoteSourceFor = (asset: "EQUITY" | "OPTION") =>
  isDemo
    ? "demo"
    : asset === "EQUITY"
      ? `alpaca-${env.ALPACA_FEED}`
      : env.OPTIONS_PROVIDER === "alpaca"
        ? "alpaca-opra"
        : env.TRADIER_BASE_URL.includes("sandbox")
          ? "tradier-delayed"
          : "tradier";
export const optionsConfigured = () =>
  env.OPTIONS_PROVIDER === "alpaca"
    ? Boolean(env.ALPACA_API_KEY && env.ALPACA_API_SECRET)
    : Boolean(env.TRADIER_API_TOKEN);
