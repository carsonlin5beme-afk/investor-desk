import { z } from "zod";
import { easternDate, sessionTime } from "./market-time";
import type { ScenarioAsset } from "./studio";

export const monthlyPolicy = "dated-intrinsic-proceeds-v1" as const;
export const monthlyTargetLimits = {
  price: 1e9,
  marketCap: 1e13,
  sharesOutstanding: 1e15,
} as const;
const price = z
  .number()
  .finite()
  .min(0)
  .max(monthlyTargetLimits.price)
  .nullable();
const rawInput = z.string().max(64);
const targetInputsSchema = z.object({
  mode: z.enum(["price", "valuation", "return"]),
  priceInputs: z.array(rawInput).min(1).max(24),
  marketCapInputs: z.array(rawInput).min(1).max(24),
  returnInputs: z.array(rawInput).min(1).max(24).optional(),
  sharesOutstandingInput: rawInput,
  sharesSource: z.literal("manual"),
});
export type MonthlyTargetInputs = z.infer<typeof targetInputsSchema> & {
  returnInputs: string[];
};
export const supportsMonthlyValuation = (symbol: string) =>
  !["SPY", "QQQ", "VOO"].includes(symbol.trim().toUpperCase());

/** Keep entered text intact; accept only finite decimal numbers, never hex. */
export function monthlyInputNumber(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return NaN;
  const parsed = Number(value);
  return parsed === 0 && /[1-9]/.test(value.split(/e/i)[0]) ? NaN : parsed;
}
export const underlyingSymbol = (value: string) => value.trim().toUpperCase();
const symbol = z.string().trim().min(1).max(80).transform(underlyingSymbol);
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Use a valid calendar date.");
const monthEndDateSchema = calendarDateSchema.refine((value) => {
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return false;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.getUTCDate() === 1;
}, "Monthly checkpoints must use the last calendar day of the month.");

const monthlyShape = z.object({
  version: z.literal(1),
  policy: z.literal(monthlyPolicy),
  dates: z.array(monthEndDateSchema).min(1).max(24),
  paths: z
    .array(
      z.object({
        symbol,
        initialPrice: price,
        prices: z.array(price).min(1).max(24),
        // Optional for backwards compatibility with saved price-only paths.
        targetInputs: targetInputsSchema.optional(),
      }),
    )
    .max(2000),
  rate: z.number().finite().min(-0.1).max(0.5),
  ivOverride: z.number().finite().min(0.01).max(5).nullable(),
  expiryPrices: z
    .array(z.object({ symbol, date: calendarDateSchema, price }))
    .max(2000),
});
const validatePlanShape = (
  plan: z.infer<typeof monthlyShape>,
  ctx: z.RefinementCtx,
) => {
  const issue = (message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (
    plan.dates.some(
      (date, index) =>
        index > 0 && date.slice(0, 7) <= plan.dates[index - 1].slice(0, 7),
    )
  )
    issue("Use one valuation date per month, in chronological order.");
  if (new Set(plan.paths.map((path) => path.symbol)).size !== plan.paths.length)
    issue("Use one price path for each underlying.");
  if (plan.paths.some((path) => path.prices.length !== plan.dates.length))
    issue("Every underlying needs one price field per month.");
  if (
    plan.paths.some(
      (path) =>
        path.targetInputs &&
        (path.targetInputs.priceInputs.length !== plan.dates.length ||
          path.targetInputs.marketCapInputs.length !== plan.dates.length ||
          (path.targetInputs.returnInputs != null &&
            path.targetInputs.returnInputs.length !== plan.dates.length) ||
          (path.targetInputs.mode === "return" &&
            path.targetInputs.returnInputs == null)),
    )
  )
    issue("Every underlying needs one target field per month.");
  if (
    new Set(plan.expiryPrices.map((point) => `${point.symbol}:${point.date}`))
      .size !== plan.expiryPrices.length
  )
    issue("Use one expiry price per underlying and expiration date.");
};
export const monthlyPlanSchema = monthlyShape.superRefine((plan, ctx) => {
  validatePlanShape(plan, ctx);
  for (const path of plan.paths) {
    const inputs = path.targetInputs;
    if (!inputs) continue;
    const issue = (message: string) =>
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${path.symbol}: ${message}`,
      });
    const valid = (raw: string, max: number, positive = false) => {
      const value = monthlyInputNumber(raw);
      return (
        value == null ||
        (Number.isFinite(value) &&
          (positive ? value > 0 : value >= 0) &&
          value <= max)
      );
    };
    if (
      inputs.mode === "price" &&
      inputs.priceInputs.some((raw) => !valid(raw, monthlyTargetLimits.price))
    )
      issue("Stock prices must be between $0 and $1 billion.");
    if (
      inputs.mode === "valuation" &&
      inputs.marketCapInputs.some(
        (raw) => !valid(raw, monthlyTargetLimits.marketCap),
      )
    )
      issue("Company valuations must be between $0 and $10 trillion.");
    // Inspect every entered rate independently: an earlier blank or zero price
    // must not conceal a later invalid rate from strict save validation.
    if (
      inputs.mode === "return" &&
      inputs.returnInputs?.some((raw) => {
        const value = monthlyInputNumber(raw);
        return value != null && (!Number.isFinite(value) || value < -100);
      })
    )
      issue("Monthly returns must be finite percentages of at least -100%.");
    if (
      inputs.mode === "return" &&
      plan.dates.some((_, index) => resolveMonthlyTarget(path, index).invalid)
    )
      issue(
        "Compounded returns must produce a finite price between $0 and $1 billion without underflow.",
      );
    const shares = monthlyInputNumber(inputs.sharesOutstandingInput);
    if (
      inputs.mode === "valuation" &&
      (!valid(
        inputs.sharesOutstandingInput,
        monthlyTargetLimits.sharesOutstanding,
        true,
      ) ||
        (shares != null && !Number.isSafeInteger(shares)))
    )
      issue(
        "Shares outstanding must be a positive whole number no greater than 1 quadrillion.",
      );
    if (inputs.mode === "valuation" && !supportsMonthlyValuation(path.symbol))
      issue("Use share-price targets for this fund.");
    // Raw price text is preserved alongside the legacy numeric price fields.
    if (
      inputs.mode === "price" &&
      inputs.priceInputs.some((raw, index) => {
        const parsed = monthlyInputNumber(raw);
        return Number.isFinite(parsed) || parsed == null
          ? parsed !== path.prices[index]
          : false;
      })
    )
      issue("Saved stock prices must match their entered values.");
    if (
      inputs.mode === "valuation" &&
      plan.dates.some((_, index) => resolveMonthlyTarget(path, index).invalid)
    )
      issue(
        "Valuation divided by shares must produce a finite price between $0 and $1 billion.",
      );
  }
});
// Tab drafts may contain a temporarily out-of-range input. Preserve it for
// correction after reload; the model and workspace API still use strict validation.
const draftPrice = z.number().finite().nullable();
export const monthlyDraftPlanSchema = monthlyShape
  .extend({
    // Recover old or invalid dated drafts intact; strict calculation/save still
    // enforces month-end. A throwing loader would discard the user's draft.
    dates: z.array(calendarDateSchema).min(1).max(24),
    paths: z
      .array(
        monthlyShape.shape.paths.element.extend({
          initialPrice: draftPrice,
          prices: z.array(draftPrice).min(1).max(24),
        }),
      )
      .max(2000),
    rate: z.number().finite(),
    ivOverride: draftPrice,
    expiryPrices: z
      .array(
        monthlyShape.shape.expiryPrices.element.extend({ price: draftPrice }),
      )
      .max(2000),
  })
  .superRefine(validatePlanShape);
export type MonthlyPlan = z.infer<typeof monthlyPlanSchema>;
export type MonthlyPath = MonthlyPlan["paths"][number];

export function monthlyTargetInputs(path: MonthlyPath): MonthlyTargetInputs {
  if (path.targetInputs)
    return {
      ...path.targetInputs,
      returnInputs: path.targetInputs.returnInputs ?? path.prices.map(() => ""),
    };
  return {
    mode: "price",
    priceInputs: path.prices.map((price) =>
      price == null ? "" : String(price),
    ),
    marketCapInputs: path.prices.map(() => ""),
    returnInputs: path.prices.map(() => ""),
    sharesOutstandingInput: "",
    sharesSource: "manual",
  };
}

/** One bounded conversion is shared by equities, options and expiry interpolation. */
export function resolveMonthlyTarget(
  path: MonthlyPath,
  index: number,
): {
  price: number | null;
  reason: string | null;
  invalid: boolean;
} {
  const inputs = path.targetInputs;
  if (!inputs || inputs.mode === "price") {
    const value = inputs
      ? monthlyInputNumber(inputs.priceInputs[index] ?? "")
      : path.prices[index];
    const valid =
      value != null &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= monthlyTargetLimits.price;
    return {
      price: valid ? value : null,
      reason: valid ? null : `Enter ${path.symbol}'s price for this month.`,
      invalid: value != null && !valid,
    };
  }
  if (inputs.mode === "return") {
    const anchor = path.initialPrice;
    if (
      anchor == null ||
      !Number.isFinite(anchor) ||
      anchor < 0 ||
      anchor > monthlyTargetLimits.price
    )
      return {
        price: null,
        reason: `Enter ${path.symbol}'s starting price for monthly returns.`,
        invalid: anchor != null,
      };
    let value: number = anchor;
    for (let month = 0; month <= index; month++) {
      const rate = monthlyInputNumber(inputs.returnInputs?.[month] ?? "");
      if (rate == null)
        return {
          price: null,
          reason: `Enter ${path.symbol}'s return for month ${month + 1} to calculate this checkpoint.`,
          invalid: false,
        };
      if (!Number.isFinite(rate) || rate < -100)
        return {
          price: null,
          reason: `Use a finite return of at least -100% for ${path.symbol} in month ${month + 1}.`,
          invalid: true,
        };
      const next = value * (1 + rate / 100);
      if (
        !Number.isFinite(next) ||
        next < 0 ||
        next > monthlyTargetLimits.price ||
        (value > 0 && rate !== -100 && next === 0)
      )
        return {
          price: null,
          reason: `The compounded price for ${path.symbol} in month ${month + 1} exceeds the supported range.`,
          invalid: true,
        };
      value = next;
    }
    return { price: value, reason: null, invalid: false };
  }
  if (!supportsMonthlyValuation(path.symbol))
    return {
      price: null,
      reason: "Use share-price targets for this fund.",
      invalid: true,
    };
  const cap = monthlyInputNumber(inputs.marketCapInputs[index] ?? "");
  const shares = monthlyInputNumber(inputs.sharesOutstandingInput);
  if (
    shares == null ||
    !Number.isSafeInteger(shares) ||
    shares <= 0 ||
    shares > monthlyTargetLimits.sharesOutstanding
  )
    return {
      price: null,
      reason: `Enter positive shares outstanding for ${path.symbol}'s valuation target.`,
      invalid: shares != null,
    };
  if (cap == null)
    return {
      price: null,
      reason: `Enter ${path.symbol}'s company valuation for this month.`,
      invalid: false,
    };
  const value = cap / shares;
  if (
    !Number.isFinite(cap) ||
    cap < 0 ||
    cap > monthlyTargetLimits.marketCap ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > monthlyTargetLimits.price ||
    (cap > 0 && value === 0)
  )
    return {
      price: null,
      reason: "Valuation divided by shares exceeds the supported price range.",
      invalid: true,
    };
  return { price: value, reason: null, invalid: false };
}

/** A planning checkpoint at 4 pm Eastern, including weekends; not a trade time. */
export const monthlyValuationAt = (date: string) => sessionTime(date, "16:00");

/** A shared quote seed, never an arbitrary choice between conflicting holdings. */
export function capturedPriceAnchor(assets: ScenarioAsset[], symbol: string) {
  const normalized = underlyingSymbol(symbol);
  const prices = [
    ...new Set(
      assets.flatMap((asset) =>
        asset.quantity > 0 &&
        underlyingSymbol(asset.symbol) === normalized &&
        asset.spot != null
          ? [asset.spot]
          : [],
      ),
    ),
  ].sort((a, b) => a - b);
  return {
    price:
      prices.length === 1 && price.safeParse(prices[0]).success
        ? prices[0]
        : null,
    conflict: prices.length > 1,
    unsupported: prices.some((value) => !price.safeParse(value).success),
    prices,
  };
}

export function nextMonthEnd(after: string) {
  const [year, month] = after.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month + 1, 0, 12)).toISOString().slice(0, 10);
}

export function createMonthlyPlan(
  assets: ScenarioAsset[],
  capturedAt: string,
  count = 6,
): MonthlyPlan {
  if (!Number.isInteger(count) || count < 1 || count > 24)
    throw new Error("Choose between one and 24 monthly checkpoints.");
  const dates: string[] = [];
  let date = easternDate(Date.parse(capturedAt));
  for (let i = 0; i < Math.min(24, Math.max(1, count)); i++) {
    date = nextMonthEnd(date);
    dates.push(date);
  }
  const symbols = [
    ...new Set(assets.map((asset) => underlyingSymbol(asset.symbol))),
  ].sort();
  return {
    version: 1,
    policy: monthlyPolicy,
    dates,
    paths: symbols.map((symbol) => {
      const initialPrice = capturedPriceAnchor(assets, symbol).price;
      return { symbol, initialPrice, prices: dates.map(() => initialPrice) };
    }),
    rate: 0.04,
    ivOverride: null,
    expiryPrices: [],
  };
}

export function validateMonthlySnapshot(snapshot: {
  capturedAt: string;
  assets: ScenarioAsset[];
  monthly?: MonthlyPlan;
}) {
  if (!snapshot.monthly) return;
  const plan = monthlyPlanSchema.parse(snapshot.monthly);
  if (
    snapshot.assets.some(
      (asset) =>
        asset.quantity === 0 &&
        (asset.currentValue !== 0 || asset.costBasis !== 0),
    )
  )
    throw new Error(
      "A zero-quantity holding has nonzero captured value or cost. Refresh the holdings snapshot before projecting it.",
    );
  const capturedAt = Date.parse(snapshot.capturedAt);
  if (
    !Number.isFinite(capturedAt) ||
    plan.dates.some((date) => {
      const at = monthlyValuationAt(date);
      return at <= capturedAt || at - capturedAt > 3660 * 86400000;
    })
  )
    throw new Error(
      "Monthly dates must follow the snapshot and stay within ten years.",
    );
  const symbols = new Set(
    snapshot.assets.map((asset) => underlyingSymbol(asset.symbol)),
  );
  if (
    new Set(snapshot.assets.map((asset) => asset.id)).size !==
    snapshot.assets.length
  )
    throw new Error("Each monthly holding must have a unique identity.");
  if (
    plan.paths.length !== symbols.size ||
    plan.paths.some((path) => !symbols.has(path.symbol))
  )
    throw new Error("Monthly prices must match the snapshot's underlyings.");
  const expiries = new Set(
    snapshot.assets.flatMap((asset) =>
      asset.option
        ? [
            `${underlyingSymbol(asset.symbol)}:${asset.option.expiration.slice(0, 10)}`,
          ]
        : [],
    ),
  );
  if (
    plan.expiryPrices.some(
      (point) => !expiries.has(`${point.symbol}:${point.date}`),
    )
  )
    throw new Error("An expiry price must match a snapshot option.");
}
