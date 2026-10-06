export type LongOptionTerms = {
  right: "CALL" | "PUT";
  strike: number;
  premium: number;
  quantity: number;
  multiplier: number;
};

/** Long-position expiration payoff. Premium is per share; fees are excluded. */
export function longOptionProfit(
  terms: LongOptionTerms,
  underlyingPrice: number,
) {
  const { right, strike, premium, quantity, multiplier } = terms;
  const shares = quantity * multiplier;
  if (
    (right !== "CALL" && right !== "PUT") ||
    ![underlyingPrice, strike, premium, quantity, multiplier].every(
      Number.isFinite,
    ) ||
    underlyingPrice < 0 ||
    strike <= 0 ||
    premium < 0 ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    !Number.isSafeInteger(multiplier) ||
    multiplier <= 0 ||
    !Number.isSafeInteger(shares)
  )
    return null;
  const intrinsicPerShare = Math.max(
    right === "CALL" ? underlyingPrice - strike : strike - underlyingPrice,
    0,
  );
  const premiumPaid = premium * shares;
  const expirationValue = intrinsicPerShare * shares;
  const expirationProfit = (intrinsicPerShare - premium) * shares;
  const breakEven = strike + (right === "CALL" ? premium : -premium);
  if (
    ![premiumPaid, expirationValue, expirationProfit, breakEven].every(
      Number.isFinite,
    )
  )
    return null;
  return {
    shares,
    intrinsicPerShare,
    premiumPaid,
    expirationValue,
    expirationProfit,
    breakEven,
  };
}

/** Keep blank or malformed inputs distinct from a valid zero-dollar target. */
export function parseHypotheticalPrice(raw: string): number | null {
  const value = raw.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}
