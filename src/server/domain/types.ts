import {
  AssetClass,
  OptionRight,
  OrderType,
  Side,
  TargetMode,
} from "@prisma/client";
import type { ClosedSessionBasis } from "@/lib/quote-status";

export interface MarketQuote {
  impliedVolatility?: number | null;
  symbol: string;
  assetClass: AssetClass;
  bid: number | null;
  ask: number | null;
  last: number | null;
  mark: number | null;
  source: string;
  asOf: Date;
}

export interface OrderTicket {
  closedSessionPreview?: ClosedSessionBasis;
  clientOrderId?: string;
  portfolioId: string;
  assetClass: AssetClass;
  symbol: string;
  side: Side;
  orderType: OrderType;
  quantity: number;
  limitPrice?: number;
  optionContractSymbol?: string;
  optionRight?: OptionRight;
  optionStrike?: number;
  optionExpiration?: Date;
}

export interface FillDecision {
  fillable: boolean;
  fillPrice?: number;
  reason?: string;
}

export interface TargetScenarioInput {
  targetMode: TargetMode;
  targetPrice?: number | null;
  targetMarketCap?: number | null;
  sharesOutstandingLive?: number | null;
  sharesOutstandingManual?: number | null;
  useManualShares?: boolean;
}
