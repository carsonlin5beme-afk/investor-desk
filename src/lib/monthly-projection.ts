import { blackScholesPrice } from "@/server/domain/black-scholes";
import { resolveOptionExpiry } from "./option-expiration";
import {
  aggregateMargin,
  defaultMarginSettings,
  elapsedMarginDays,
  projectMarginDebt,
  type MarginSummary,
} from "./margin";
import {
  monthlyPlanSchema,
  monthlyValuationAt,
  resolveMonthlyTarget,
  underlyingSymbol,
  validateMonthlySnapshot,
  type MonthlyPlan,
} from "./monthly-scenario";
import {
  validateScenarioPortfolios,
  type SavedScenario,
  type ScenarioAsset,
} from "./studio";

// All displayed position values are rounded once; aggregate integer cents.
const money = (value: number): number | null => {
  const cents = Math.round((value + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents / 100 : null;
};
const sum = (values: (number | null)[]): number | null => {
  if (values.some((value) => value == null)) return null;
  const cents = values.reduce<number>(
    (total, value) => total + Math.round(value! * 100),
    0,
  );
  return Number.isSafeInteger(cents) ? cents / 100 : null;
};
export type MonthlyPosition = {
  id: string;
  portfolioId: string;
  label: string;
  symbol: string;
  quantity: number;
  kind: "equity" | "option";
  state: "shares" | "model" | "liquidated" | "unavailable";
  spot: number | null;
  holdingValue: number | null;
  expiryProceeds: number | null;
  value: number | null;
  cost: number | null;
  profit: number | null;
  intrinsic: number | null;
  expiryAt: string | null;
  expirySpot: number | null;
  expirySource: "override" | "interpolated" | null;
  iv: number | null;
  ivEstimated: boolean;
  warnings: string[];
  reason: string | null;
};
export type MonthlyPortfolioMargin = {
  id: string;
  name: string;
  /** Captured cash plus this account's simulated option expiry proceeds. */
  cash: number | null;
  principal: number;
  interest: number | null;
  outstandingDebt: number | null;
  marginSummary: MarginSummary | null;
};
export type MonthlyResult = {
  date: string;
  at: string;
  positions: MonthlyPosition[];
  cash: number | null;
  equities: number | null;
  options: number | null;
  expiryProceeds: number | null;
  grossTotal: number | null;
  principal: number | null;
  interest: number | null;
  outstandingDebt: number | null;
  netEquity: number | null;
  /** Alias of netEquity for the monthly chart and existing row selection. */
  total: number | null;
  portfolioMargins: MonthlyPortfolioMargin[];
  marginSummary: MarginSummary | null;
  /** Known gross assets only: never deduct debt from an incomplete subtotal. */
  knownSubtotal: number | null;
  profit: number | null;
  change: number | null;
  changePercent: number | null;
  costReturnPercent: number | null;
  missingCount: number;
  unavailableReason: string | null;
};

/** Projected liabilities may exceed the entry cap while remaining calculable. */
function projectedMarginSummary(
  cash: number | null,
  equities: number | null,
  options: number | null,
  debt: number | null,
  maintenancePercent: number,
): MarginSummary | null {
  if (debt == null) return null;
  const grossValue = sum([cash, equities, options]);
  const netEquity = grossValue == null ? null : sum([grossValue, -debt]);
  const marginEquity = sum([cash, equities, -debt]);
  const maintenanceRequired =
    equities == null ? null : money((maintenancePercent / 100) * equities);
  const maintenanceExcess =
    maintenanceRequired == null
      ? null
      : sum([marginEquity, -maintenanceRequired]);
  if (
    grossValue == null ||
    netEquity == null ||
    marginEquity == null ||
    maintenanceRequired == null ||
    maintenanceExcess == null
  )
    return null;
  return {
    debt,
    grossValue,
    netEquity,
    marginEquity,
    maintenanceRequired,
    maintenanceExcess,
    maintenanceShortfall: Math.max(0, -maintenanceExcess),
  };
}

function aggregateMonthlyMargin(
  summaries: (MarginSummary | null)[],
): MarginSummary | null {
  const result = aggregateMargin(summaries);
  if (result == null) return null;
  // Preserve shared per-account shortfalls while aggregating integer cents.
  for (const field of Object.keys(result) as (keyof MarginSummary)[]) {
    const value = sum(summaries.map((summary) => summary![field]));
    if (value == null) return null;
    result[field] = value;
  }
  return result;
}

/** Never skip a missing checkpoint, interpolate backwards or extrapolate. */
export function expiryPrice(
  plan: MonthlyPlan,
  symbol: string,
  expiryAt: number,
  capturedAt: number,
  checkpoints = plan.dates.map(monthlyValuationAt),
): { price: number | null; source: "override" | "interpolated" | null } {
  const normalized = underlyingSymbol(symbol);
  const date = new Date(expiryAt).toISOString().slice(0, 10);
  const override = plan.expiryPrices.find(
    (point) => point.symbol === normalized && point.date === date,
  );
  if (override?.price != null)
    return { price: override.price, source: "override" };
  const path = plan.paths.find((path) => path.symbol === normalized);
  if (!path || expiryAt <= capturedAt) return { price: null, source: null };
  const points = [
    { at: capturedAt, price: path.initialPrice },
    ...checkpoints.map((at, index) => ({
      at,
      price: resolveMonthlyTarget(path, index).price,
    })),
  ];
  const rightIndex = points.findIndex((point) => point.at >= expiryAt);
  if (rightIndex < 1) return { price: null, source: null };
  const right = points[rightIndex],
    left = points[rightIndex - 1];
  if (right.at === expiryAt)
    return {
      price: right.price,
      source: right.price == null ? null : "interpolated",
    };
  if (left.price == null || right.price == null)
    return { price: null, source: null };
  return {
    price:
      left.price +
      ((right.price - left.price) * (expiryAt - left.at)) /
        (right.at - left.at),
    source: "interpolated",
  };
}

function positionAt(
  asset: ScenarioAsset,
  plan: MonthlyPlan,
  month: number,
  at: number,
  capturedAt: number,
  path: MonthlyPlan["paths"][number],
  resolvedExpiry: ReturnType<typeof resolveOptionExpiry> | null,
  terminal: ReturnType<typeof expiryPrice> | null,
): MonthlyPosition {
  const warnings: string[] = [];
  if (!asset.quoteQuality)
    warnings.push("Legacy snapshot: quote and IV quality are unknown.");
  else {
    if (asset.quoteQuality.estimated)
      warnings.push("Captured current value is a cost-basis estimate.");
    if (asset.quoteQuality.source === "manual")
      warnings.push("Manual entry: no market quote was captured.");
    else if (asset.quoteQuality.stale)
      warnings.push("Captured quote was stale.");
  }
  const result: MonthlyPosition = {
    id: asset.id,
    portfolioId: asset.portfolioId,
    label: asset.label,
    symbol: path.symbol,
    quantity: asset.quantity,
    kind: asset.option ? "option" : "equity",
    state: "unavailable",
    spot: resolveMonthlyTarget(path, month).price,
    holdingValue: null,
    expiryProceeds: null,
    value: null,
    cost: money(asset.costBasis),
    profit: null,
    intrinsic: null,
    expiryAt: null,
    expirySpot: null,
    expirySource: null,
    iv: null,
    ivEstimated: Boolean(
      asset.option &&
      plan.ivOverride == null &&
      (asset.quoteQuality?.ivEstimated ?? true),
    ),
    warnings,
    reason: null,
  };
  const unavailable = (reason: string) => ({ ...result, reason });
  if (result.cost == null)
    return unavailable("Holding cost exceeds the supported calculation range.");
  if (!asset.option) {
    if (result.spot == null)
      return unavailable(resolveMonthlyTarget(path, month).reason!);
    result.holdingValue = money(asset.quantity * result.spot);
    result.expiryProceeds = 0;
    result.state = "shares";
  } else {
    const option = asset.option;
    const expiry = resolvedExpiry!;
    const expires = expiry.modelExpirationAt.getTime();
    result.expiryAt = expiry.modelExpirationAt.toISOString();
    if (expiry.scheduleStatus !== "KNOWN")
      warnings.push(
        "Expiry time uses the model calendar assumption; trading cutoff is unverified.",
      );
    if (expires <= capturedAt)
      return unavailable(
        "Already expired at capture. Starting cash may already include proceeds; this holding cannot be safely projected.",
      );
    const intrinsic = (spot: number) =>
      Math.max(
        option.right === "CALL" ? spot - option.strike : option.strike - spot,
        0,
      ) *
      asset.quantity *
      option.multiplier;
    result.iv = plan.ivOverride ?? option.iv;
    if (result.ivEstimated)
      warnings.push("IV is an estimate or its original source is unknown.");
    if (at >= expires) {
      result.expirySpot = terminal!.price;
      result.expirySource = terminal!.source;
      if (terminal!.price == null)
        return unavailable(
          `Enter an expiry price for ${path.symbol}, or fill both adjacent path checkpoints.`,
        );
      result.holdingValue = 0;
      result.expiryProceeds = money(intrinsic(terminal!.price));
      result.intrinsic = result.expiryProceeds;
      result.state = "liquidated";
    } else {
      if (result.spot == null)
        return unavailable(resolveMonthlyTarget(path, month).reason!);
      result.intrinsic = money(intrinsic(result.spot));
      try {
        result.holdingValue = money(
          blackScholesPrice({
            spot: result.spot,
            strike: option.strike,
            timeToExpiryYears: (expires - at) / (365 * 86400000),
            riskFreeRate: plan.rate,
            volatility: result.iv,
            isCall: option.right === "CALL",
          }) *
            asset.quantity *
            option.multiplier,
        );
      } catch {
        return unavailable("Option inputs exceed the supported model range.");
      }
      result.expiryProceeds = 0;
      result.state = "model";
    }
  }
  result.value = sum([result.holdingValue, result.expiryProceeds]);
  result.profit =
    result.value == null ? null : money(result.value - result.cost);
  if (result.value == null || result.profit == null) {
    result.state = "unavailable";
    result.reason = "Value exceeds the supported calculation range.";
    result.value = result.profit = null;
  }
  return result;
}

/** Pure scenario arithmetic: never mutates holdings, ledger cash or quote state. */
export function projectMonthly(snapshot: SavedScenario): MonthlyResult[] {
  if (!snapshot.monthly) return [];
  validateScenarioPortfolios(snapshot);
  validateMonthlySnapshot(snapshot);
  const plan = monthlyPlanSchema.parse(snapshot.monthly);
  const capturedAt = Date.parse(snapshot.capturedAt);
  const cash = money(snapshot.cash);
  const grossBaseline = sum([
    cash,
    ...snapshot.assets.map((asset) =>
      asset.quantity === 0 ? 0 : money(asset.currentValue),
    ),
  ]);
  const cost = sum(
    snapshot.assets.map((asset) =>
      asset.quantity === 0 ? 0 : money(asset.costBasis),
    ),
  );
  const principal = sum(
    (snapshot.portfolioSnapshots ?? []).map(
      (portfolio) => portfolio.margin.debt,
    ),
  );
  const baseline = principal == null ? null : sum([grossBaseline, -principal]);
  const checkpoints = plan.dates.map(monthlyValuationAt);
  const paths = new Map(plan.paths.map((path) => [path.symbol, path]));
  const terminals = new Map<string, ReturnType<typeof expiryPrice>>();
  const inputs = snapshot.assets
    .filter((asset) => asset.quantity > 0)
    .map((asset) => {
      const path = paths.get(underlyingSymbol(asset.symbol))!;
      const expiry =
        asset.option && asset.quantity > 0
          ? resolveOptionExpiry(asset.option.expiration, path.symbol)
          : null;
      let terminal: ReturnType<typeof expiryPrice> | null = null;
      if (expiry) {
        const key = `${path.symbol}:${expiry.modelExpirationAt.toISOString()}`;
        terminal =
          terminals.get(key) ??
          expiryPrice(
            plan,
            path.symbol,
            expiry.modelExpirationAt.getTime(),
            capturedAt,
            checkpoints,
          );
        terminals.set(key, terminal);
      }
      return { asset, path, expiry, terminal };
    });
  return plan.dates.map((date, index) => {
    const at = checkpoints[index];
    const positions = inputs.map(({ asset, path, expiry, terminal }) =>
      positionAt(asset, plan, index, at, capturedAt, path, expiry, terminal),
    );
    const holdingsAndProceeds = sum(
      positions.map((position) => position.value),
    );
    const grossTotal = sum([cash, holdingsAndProceeds]);
    const equities = sum(
      positions
        .filter((position) => position.kind === "equity")
        .map((position) => position.holdingValue),
    );
    const options = sum(
      positions
        .filter((position) => position.kind === "option")
        .map((position) => position.holdingValue),
    );
    const expiryProceeds = sum(
      positions.map((position) => position.expiryProceeds),
    );
    const elapsedDays = elapsedMarginDays(snapshot.capturedAt, at);
    const accountPositions = new Map<string, MonthlyPosition[]>();
    for (const position of positions) {
      const group = accountPositions.get(position.portfolioId) ?? [];
      group.push(position);
      accountPositions.set(position.portfolioId, group);
    }
    const portfolioMargins: MonthlyPortfolioMargin[] = (
      snapshot.portfolioSnapshots ?? []
    ).map((portfolio) => {
      const owned = accountPositions.get(portfolio.id) ?? [];
      const projection =
        elapsedDays == null
          ? null
          : projectMarginDebt(portfolio.margin, elapsedDays);
      // Cumulative interest is rounded once per account, never each day/month.
      const interest = projection == null ? null : money(projection.interest);
      const debt = sum([portfolio.margin.debt, interest]);
      const proceeds = sum(
        owned
          .filter((position) => position.kind === "option")
          .map((position) =>
            position.expiryAt != null && at < Date.parse(position.expiryAt)
              ? 0
              : position.expiryProceeds,
          ),
      );
      const accountCash = sum([money(portfolio.cash), proceeds]);
      const accountEquities = sum(
        owned
          .filter((position) => position.kind === "equity")
          .map((position) => position.holdingValue),
      );
      const accountOptions = sum(
        owned
          .filter((position) => position.kind === "option")
          .map((position) => position.holdingValue),
      );
      return {
        id: portfolio.id,
        name: portfolio.name,
        cash: accountCash,
        principal: portfolio.margin.debt,
        interest,
        outstandingDebt: debt,
        marginSummary: projectedMarginSummary(
          accountCash,
          accountEquities,
          accountOptions,
          debt,
          portfolio.margin.maintenancePercent,
        ),
      };
    });
    const interest =
      elapsedDays == null
        ? null
        : sum(portfolioMargins.map((portfolio) => portfolio.interest));
    const outstandingDebt =
      principal == null ? null : sum([principal, interest]);
    const netEquity =
      outstandingDebt == null ? null : sum([grossTotal, -outstandingDebt]);
    const marginSummary =
      grossTotal == null || outstandingDebt == null
        ? null
        : snapshot.portfolioSnapshots
          ? aggregateMonthlyMargin(
              portfolioMargins.map((portfolio) => portfolio.marginSummary),
            )
          : projectedMarginSummary(
              sum([cash, expiryProceeds]),
              equities,
              options,
              0,
              defaultMarginSettings.maintenancePercent,
            );
    const profit =
      grossTotal == null || holdingsAndProceeds == null || cost == null
        ? null
        : sum([
            holdingsAndProceeds,
            -cost,
            interest == null ? null : -interest,
          ]);
    const change =
      netEquity == null || baseline == null
        ? null
        : sum([netEquity, -baseline]);
    return {
      date,
      at: new Date(at).toISOString(),
      positions,
      cash,
      equities,
      options,
      expiryProceeds,
      grossTotal,
      principal,
      interest,
      outstandingDebt,
      netEquity,
      total: netEquity,
      portfolioMargins,
      marginSummary,
      knownSubtotal: sum([
        ...(cash == null ? [] : [cash]),
        ...positions
          .filter((position) => position.value != null)
          .map((position) => position.value),
      ]),
      profit,
      change,
      changePercent:
        change == null || baseline == null || baseline <= 0
          ? null
          : (change / baseline) * 100,
      costReturnPercent:
        profit == null || cost == null || cost <= 0
          ? null
          : (profit / cost) * 100,
      missingCount: positions.filter((position) => position.value == null)
        .length,
      unavailableReason:
        cash == null
          ? "Starting cash exceeds the supported calculation range."
          : grossTotal == null &&
              positions.every((position) => position.value != null)
            ? "The combined portfolio value exceeds the supported calculation range."
            : elapsedDays == null
              ? "Capture or projection dates are invalid; financing is unavailable."
              : interest == null || outstandingDebt == null
                ? "Financing exceeds the supported calculation range."
                : baseline == null
                  ? "The captured value exceeds the supported calculation range; change versus snapshot is unavailable."
                  : cost == null
                    ? "Holding costs exceed the supported calculation range; profit is unavailable."
                    : null,
    };
  });
}
