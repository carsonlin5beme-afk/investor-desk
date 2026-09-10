/** Illustrative fixtures only. This preview never reads or changes a portfolio. */
export function landingScenario(kind: "equity" | "option", target: number) {
  if (!Number.isFinite(target) || target < 0)
    throw new Error("Target must be a nonnegative number.");
  const startingCash = 250000;
  const quantity = kind === "equity" ? 228 : 600;
  const multiplier = kind === "equity" ? 1 : 100;
  const entryPrice = kind === "equity" ? 320.05 : 1.83;
  const currentMark = kind === "equity" ? 320 : 1.82;
  const targetPrice = kind === "equity" ? target : (target * 1e9) / 1.35e9;
  const round = (n: number) => Math.round(n * 100) / 100;
  const cash = round(startingCash - quantity * multiplier * entryPrice);
  const projectedHolding = round(
    quantity *
      multiplier *
      (kind === "equity" ? targetPrice : Math.max(0, targetPrice - 5)),
  );
  return {
    cash,
    targetPrice,
    projectedHolding,
    currentValue: round(cash + quantity * multiplier * currentMark),
    projectedValue: round(cash + projectedHolding),
  };
}
