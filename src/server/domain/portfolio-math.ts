import { AssetClass } from "@prisma/client";

import { MarketQuote } from "@/server/domain/types";

export interface PositionMarkInput {
  assetClass: AssetClass;
  quantity: number;
  avgCost: number;
  quote: MarketQuote | null;
}

export interface PositionMarkOutput {
  marketValue: number;
  unrealizedPnL: number;
}

export const positionMark = (input: PositionMarkInput): PositionMarkOutput => {
  const mark = input.quote?.mark ?? input.quote?.last ?? 0;
  const multiplier = input.assetClass === AssetClass.OPTION ? 100 : 1;
  const marketValue = input.quantity * mark * multiplier;
  const costBasis = input.quantity * input.avgCost * multiplier;
  return {
    marketValue,
    unrealizedPnL: marketValue - costBasis,
  };
};
