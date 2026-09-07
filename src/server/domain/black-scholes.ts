const normalCdf = (x: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  let probability =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  probability = 1 - probability;
  return x >= 0 ? probability : 1 - probability;
};

export interface BlackScholesInput {
  spot: number;
  strike: number;
  timeToExpiryYears: number;
  riskFreeRate: number;
  volatility: number;
  isCall: boolean;
}

export const blackScholesPrice = (input: BlackScholesInput): number => {
  const { spot, strike, timeToExpiryYears, riskFreeRate, volatility, isCall } =
    input;

  if (timeToExpiryYears <= 0 || volatility <= 0 || spot <= 0 || strike <= 0) {
    return Math.max(isCall ? spot - strike : strike - spot, 0);
  }

  const sqrtT = Math.sqrt(timeToExpiryYears);
  const d1 =
    (Math.log(spot / strike) +
      (riskFreeRate + (volatility * volatility) / 2) * timeToExpiryYears) /
    (volatility * sqrtT);
  const d2 = d1 - volatility * sqrtT;

  if (isCall) {
    return (
      spot * normalCdf(d1) -
      strike * Math.exp(-riskFreeRate * timeToExpiryYears) * normalCdf(d2)
    );
  }

  return (
    strike * Math.exp(-riskFreeRate * timeToExpiryYears) * normalCdf(-d2) -
    spot * normalCdf(-d1)
  );
};
