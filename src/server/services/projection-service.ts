import { Prisma, TargetMode } from "@prisma/client";
import { env } from "@/lib/env";
import {
  deriveTargetPriceFromScenario,
  projectEquityValue,
  projectOptionIntrinsicValue,
  projectOptionModelValue,
  sumProjectedNetWorth,
} from "@/server/domain/projection";
import { getLiveQuote, quoteMark } from "./quote-service";
type PositionWithRelations = Prisma.PositionGetPayload<{
  include: { targetScenario: true; optionDetails: true };
}>;
export async function buildPositionProjection(position: PositionWithRelations) {
  const quote = await getLiveQuote(position.symbol, position.assetClass);
  const mark = quoteMark(quote);
  const quantity = position.quantity.toNumber(),
    avgCost = position.avgCost.toNumber();
  const multiplier = position.optionDetails?.multiplier ?? 1;
  const currentMarketValue =
    Math.round((mark ?? avgCost) * quantity * multiplier * 100) / 100;
  const s = position.targetScenario;
  const targetUnderlyingPrice = deriveTargetPriceFromScenario({
    targetMode: s?.targetMode ?? TargetMode.PRICE,
    targetPrice: s?.targetPrice?.toNumber(),
    targetMarketCap: s?.targetMarketCap?.toNumber(),
    sharesOutstandingLive: s?.sharesOutstandingLive?.toNumber(),
    sharesOutstandingManual: s?.sharesOutstandingManual?.toNumber(),
    useManualShares: s?.useManualShares,
  });
  const option = position.optionDetails;
  const iv = quote?.impliedVolatility;
  const modelIV = iv != null && iv > 0 ? iv : 0.6;
  const intrinsic = option
    ? projectOptionIntrinsicValue(
        option.right,
        option.strike.toNumber(),
        quantity,
        multiplier,
        targetUnderlyingPrice,
      )
    : null;
  const model = option
    ? projectOptionModelValue({
        right: option.right,
        strike: option.strike.toNumber(),
        contracts: quantity,
        multiplier,
        targetUnderlyingPrice,
        impliedVolatility: modelIV,
        expiration: option.expiration,
      })
    : null;
  const targetValue = option
    ? model
    : projectEquityValue(quantity, targetUnderlyingPrice);
  const underlyingQuote = option
    ? await getLiveQuote(option.underlying, "EQUITY")
    : quote;
  return {
    positionId: position.id,
    symbol: position.symbol,
    assetClass: position.assetClass,
    currentMarketValue,
    currentPrice: mark,
    costBasis: Math.round(avgCost * quantity * multiplier * 100) / 100,
    unrealizedPnL:
      Math.round((currentMarketValue - avgCost * quantity * multiplier) * 100) /
      100,
    targetUnderlyingPrice,
    projectedValue: targetValue ?? currentMarketValue,
    optionIntrinsicProjectedValue: intrinsic,
    optionModelProjectedValue: model,
    hasTarget: targetUnderlyingPrice !== null,
    priceEstimated: mark === null,
    quoteStale:
      !quote ||
      Date.now() - quote.asOf.getTime() > env.QUOTE_STALE_SECONDS * 1000,
    quoteAsOf: quote?.asOf.toISOString() ?? null,
    quoteSource: quote?.source ?? "unavailable",
    impliedVolatility: option ? modelIV : null,
    ivEstimated: Boolean(option && !(iv != null && iv > 0)),
    underlyingPrice: quoteMark(underlyingQuote),
    expired: Boolean(option && option.expiration.getTime() <= Date.now()),
  };
}
export type PositionProjection = Awaited<
  ReturnType<typeof buildPositionProjection>
>;
export const aggregatePortfolioProjection = (
  cashBalance: number,
  positions: PositionProjection[],
) => ({
  projectedNetWorth: sumProjectedNetWorth(
    cashBalance,
    positions.map((p) => p.projectedValue),
  ),
  projectedPositionsTotal: sumProjectedNetWorth(
    0,
    positions.map((p) => p.projectedValue),
  ),
  intrinsicNetWorth: sumProjectedNetWorth(
    cashBalance,
    positions.map((p) => p.optionIntrinsicProjectedValue ?? p.projectedValue),
  ),
  targetCount: positions.filter((p) => p.hasTarget).length,
  estimatedCount: positions.filter((p) => p.priceEstimated).length,
});
