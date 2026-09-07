import { OptionRight, TargetMode } from "@prisma/client";

import { roundCurrency } from "@/lib/decimal";
import { blackScholesPrice } from "@/server/domain/black-scholes";
import { TargetScenarioInput } from "@/server/domain/types";

const resolveSharesOutstanding = (
  scenario: TargetScenarioInput,
): number | null => {
  if (scenario.useManualShares)
    return scenario.sharesOutstandingManual &&
      scenario.sharesOutstandingManual > 0
      ? scenario.sharesOutstandingManual
      : null;

  if (scenario.sharesOutstandingLive && scenario.sharesOutstandingLive > 0) {
    return scenario.sharesOutstandingLive;
  }

  return null;
};

export const deriveTargetPriceFromScenario = (
  scenario: TargetScenarioInput,
): number | null => {
  if (scenario.targetMode === TargetMode.PRICE) {
    return scenario.targetPrice ?? null;
  }

  if (!scenario.targetMarketCap || scenario.targetMarketCap <= 0) {
    return null;
  }

  const sharesOutstanding = resolveSharesOutstanding(scenario);
  if (!sharesOutstanding || sharesOutstanding <= 0) {
    return null;
  }

  return scenario.targetMarketCap / sharesOutstanding;
};

export const projectEquityValue = (
  quantity: number,
  targetPrice: number | null,
): number | null => {
  if (targetPrice == null || targetPrice < 0) {
    return null;
  }
  return roundCurrency(quantity * targetPrice);
};

export const projectOptionIntrinsicValue = (
  right: OptionRight,
  strike: number,
  contracts: number,
  multiplier: number,
  targetUnderlyingPrice: number | null,
): number | null => {
  if (targetUnderlyingPrice == null || targetUnderlyingPrice < 0) {
    return null;
  }

  const intrinsicPerShare =
    right === OptionRight.CALL
      ? Math.max(0, targetUnderlyingPrice - strike)
      : Math.max(0, strike - targetUnderlyingPrice);

  return roundCurrency(intrinsicPerShare * contracts * multiplier);
};

export interface OptionModelProjectionInput {
  right: OptionRight;
  strike: number;
  contracts: number;
  multiplier: number;
  targetUnderlyingPrice: number | null;
  impliedVolatility: number;
  riskFreeRate?: number;
  expiration: Date;
  now?: Date;
}

export const projectOptionModelValue = (
  input: OptionModelProjectionInput,
): number | null => {
  if (input.targetUnderlyingPrice == null || input.targetUnderlyingPrice < 0) {
    return null;
  }

  if (input.targetUnderlyingPrice === 0)
    return projectOptionIntrinsicValue(
      input.right,
      input.strike,
      input.contracts,
      input.multiplier,
      0,
    );
  const now = input.now ?? new Date();
  const msToExpiry = input.expiration.getTime() - now.getTime();
  const yearsToExpiry = Math.max(msToExpiry / (1000 * 60 * 60 * 24 * 365), 0);

  const optionPrice = blackScholesPrice({
    spot: input.targetUnderlyingPrice,
    strike: input.strike,
    timeToExpiryYears: yearsToExpiry,
    riskFreeRate: input.riskFreeRate ?? 0.04,
    volatility: Math.max(input.impliedVolatility, 0.0001),
    isCall: input.right === OptionRight.CALL,
  });

  return roundCurrency(optionPrice * input.contracts * input.multiplier);
};

export const sumProjectedNetWorth = (
  cashBalance: number,
  projectedPositionValues: Array<number | null>,
): number => {
  const positionsTotal = projectedPositionValues.reduce<number>(
    (acc, value) => acc + (value ?? 0),
    0,
  );
  return roundCurrency(cashBalance + positionsTotal);
};
