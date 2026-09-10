import { env } from "@/lib/env";
import { SchwabEquityProvider, SchwabOptionsProvider } from "./schwab";
import { schwabConnected } from "./schwab-client";
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
  equities: isDemo
    ? new DemoEquityProvider()
    : env.EQUITY_PROVIDER === "schwab"
      ? new SchwabEquityProvider()
      : new AlpacaEquityProvider(),
  options: isDemo
    ? new DemoOptionsProvider()
    : env.OPTIONS_PROVIDER === "schwab"
      ? new SchwabOptionsProvider()
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
      ? env.EQUITY_PROVIDER === "schwab"
        ? "schwab-equity"
        : `alpaca-${env.ALPACA_FEED}`
      : env.OPTIONS_PROVIDER === "schwab"
        ? "schwab-option"
        : env.OPTIONS_PROVIDER === "alpaca"
          ? "alpaca-opra"
          : env.TRADIER_BASE_URL.includes("sandbox")
            ? "tradier-delayed"
            : "tradier";
export const equitiesConfigured = () =>
  env.EQUITY_PROVIDER === "schwab"
    ? schwabConnected()
    : Boolean(env.ALPACA_API_KEY && env.ALPACA_API_SECRET);
export const equityFeedConfigured = () =>
  env.EQUITY_PROVIDER === "schwab" ? "schwab" : env.ALPACA_FEED;
export const optionsConfigured = () =>
  env.OPTIONS_PROVIDER === "schwab"
    ? schwabConnected()
    : env.OPTIONS_PROVIDER === "alpaca"
      ? Boolean(env.ALPACA_API_KEY && env.ALPACA_API_SECRET)
      : Boolean(env.TRADIER_API_TOKEN);
