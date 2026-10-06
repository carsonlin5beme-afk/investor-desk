import {
  resolveMarginSettings,
  marginSettingsSchema,
  elapsedMarginDays,
  projectMarginDebt,
} from "./margin";
import { z } from "zod";
import { scenarioTaxSettingsSchema } from "./scenario-tax";
import type { Holding, Portfolio } from "./desk-types";
import { blackScholesPrice } from "@/server/domain/black-scholes";
import { resolveOptionExpiry, optionExpiryPolicy } from "./option-expiration";
import { monthlyPlanSchema, validateMonthlySnapshot } from "./monthly-scenario";

const finite = z.number().finite();
// Match the projection service's per-position cent rounding without importing
// its Prisma-dependent decimal module into the browser bundle.
const currency = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
export const scenarioAssetSchema = z.object({
  id: z.string().max(150),
  portfolioId: z.string().max(150),
  symbol: z.string().max(80),
  label: z.string().max(180),
  quantity: finite.nonnegative().max(1e14),
  currentValue: finite.nonnegative().max(1e20),
  costBasis: finite.nonnegative().max(1e20),
  spot: finite.nonnegative().max(1e16).nullable(),
  target: finite.nonnegative().max(1e16).nullable(),
  quoteQuality: z
    .object({
      estimated: z.boolean(),
      stale: z.boolean(),
      asOf: z.string().datetime().nullable(),
      source: z.string().max(100),
      ivEstimated: z.boolean(),
    })
    .optional(),
  option: z
    .object({
      strike: finite.nonnegative().max(1e16),
      expiration: z.string().datetime(),
      right: z.enum(["CALL", "PUT"]),
      iv: finite.positive().max(10),
      multiplier: finite.positive().max(1000),
    })
    .nullable(),
});
export type ScenarioAsset = z.infer<typeof scenarioAssetSchema>;
export const assumptionsSchema = z.object({
  rate: finite.min(-0.1).max(0.5),
  iv: finite.min(0.01).max(5).nullable(),
  daysForward: finite.min(0).max(3650).nullable(),
});
export type Assumptions = z.infer<typeof assumptionsSchema>;
export const defaultAssumptions: Assumptions = {
  rate: 0.04,
  iv: null,
  daysForward: 0,
};
export const frozenPortfoliosSchema = z
  .array(
    z
      .object({
        id: z.string().min(1).max(150),
        name: z.string().max(80),
        cash: finite
          .nonnegative()
          .max(1e20)
          .refine(
            (v) => Math.round(v * 100) / 100 === v,
            "Frozen portfolio cash must use whole cents.",
          ),
        margin: marginSettingsSchema,
      })
      .strict(),
  )
  .max(100);
export const scenarioSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  notes: z.string().max(4000),
  capturedAt: z.string().datetime(),
  expirationPolicy: z.string().max(100).optional(),
  portfolioNames: z.array(z.string().max(80)).max(100),
  cash: finite.nonnegative().max(1e20),
  // Omitted in legacy snapshots: those scenarios have zero modeled debt.
  portfolioSnapshots: frozenPortfoliosSchema.optional(),
  assets: z.array(scenarioAssetSchema).max(2000),
  assumptions: assumptionsSchema,
  monthly: monthlyPlanSchema.optional(),
  tax: scenarioTaxSettingsSchema.optional(),
});
export type SavedScenario = z.infer<typeof scenarioSchema>;

/** Frozen accounts must agree with the gross cash and holding scope. */
export function validateScenarioPortfolios(
  scenario: Pick<SavedScenario, "portfolioSnapshots" | "cash" | "assets">,
) {
  if (!scenario.portfolioSnapshots) return;
  const accounts = frozenPortfoliosSchema.parse(scenario.portfolioSnapshots);
  const ids = new Set(accounts.map((p) => p.id));
  if (ids.size !== accounts.length)
    throw new Error("Snapshot portfolio IDs must be unique.");
  if (scenario.assets.some((a) => !ids.has(a.portfolioId)))
    throw new Error("A holding is outside the frozen portfolio scope.");
  const cash = accounts.reduce((sum, p) => sum + p.cash, 0);
  if (!Number.isFinite(cash) || Math.abs(cash - scenario.cash) > 0.000001)
    throw new Error("Frozen portfolio cash does not match the snapshot total.");
  accounts.forEach((p) => marginSettingsSchema.parse(p.margin));
}

/** Tax assumptions cover exactly the positive captured holdings; unknown inputs stay unknown. */
export function validateScenarioTax(
  scenario: Pick<SavedScenario, "assets" | "tax">,
) {
  if (!scenario.tax) return;
  const settings = scenarioTaxSettingsSchema.parse(scenario.tax);
  const active = scenario.assets.filter((asset) => asset.quantity > 0);
  const ids = new Set(active.map((asset) => asset.id));
  if (ids.size !== active.length)
    throw new Error("Tax holding IDs must be unique.");
  if (
    settings.assumptions.length !== ids.size ||
    settings.assumptions.some((a) => !ids.has(a.assetId))
  )
    throw new Error("Tax assumptions must match the captured holdings.");
}

/** New financing expense is computed independently of option model rates. */
export function scenarioFinancing(
  scenario: Pick<
    SavedScenario,
    "portfolioSnapshots" | "capturedAt" | "assumptions"
  >,
) {
  if (scenario.assumptions.daysForward == null) return null;
  const at = Date.parse(scenario.capturedAt);
  const days = elapsedMarginDays(
    at,
    at + scenario.assumptions.daysForward * 86400000,
  );
  if (days == null) return null;
  let principal = 0,
    interest = 0;
  for (const p of scenario.portfolioSnapshots ?? []) {
    const projection = projectMarginDebt(p.margin, days);
    if (!projection) return null;
    const cents = Math.round(projection.interest * 100);
    if (!Number.isSafeInteger(cents)) return null;
    principal += projection.principal;
    interest += cents / 100;
  }
  const outstandingDebt = currency(principal + interest);
  return [principal, interest, outstandingDebt].every((v) =>
    Number.isSafeInteger(Math.round(v * 100)),
  )
    ? {
        principal: currency(principal),
        interest: currency(interest),
        outstandingDebt,
        elapsedDays: days,
      }
    : null;
}

/** Nonfinite results are unavailable; charts and currency labels guard them. */
export function scenarioTotalAt(
  scenario: SavedScenario,
  progress: number,
  mode: "model" | "intrinsic" = "model",
) {
  const financing = scenarioFinancing(scenario);
  if (!financing) return NaN;
  return currency(
    totalAt(
      scenario.assets,
      scenario.cash,
      progress,
      mode,
      scenario.assumptions,
      Date.parse(scenario.capturedAt),
    ) - financing.outstandingDebt,
  );
}
export const journalSchema = z.object({
  id: z.string().uuid(),
  holdingId: z.string().max(150),
  symbol: z.string().max(80),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(12000),
  source: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => {
      if (!v) return true;
      try {
        const url = new URL(v);
        return ["https:", "http:"].includes(url.protocol) && !!url.hostname;
      } catch {
        return false;
      }
    }, "Use an https:// or http:// evidence link."),
  reviewDate: z
    .string()
    .max(10)
    .refine(
      (v) =>
        !v ||
        (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
          !Number.isNaN(Date.parse(v)) &&
          new Date(v).toISOString().slice(0, 10) === v),
      "Use a valid date in YYYY-MM-DD format.",
    ),
  revisions: z
    .array(z.object({ body: z.string().max(12000), at: z.string().datetime() }))
    .max(20),
});
export type JournalNote = z.infer<typeof journalSchema>;
export const preferencesSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  density: z.enum(["comfortable", "compact"]),
  pinned: z.array(z.string().max(150)).max(100),
  archived: z.array(z.string().max(150)).max(100),
  privacy: z.boolean(),
  order: z.array(z.string().max(150)).max(100),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = {
  theme: "dark",
  density: "comfortable",
  pinned: [],
  archived: [],
  privacy: false,
  order: [],
};
export type WorkspaceValue = SavedScenario | JournalNote | Preferences;
export type WorkspaceEntry = {
  key: string;
  value: WorkspaceValue;
  version: number;
  updatedAt: string;
};
export function validateWorkspaceValue(
  key: string,
  value: unknown,
): WorkspaceValue {
  if (key === "preferences") return preferencesSchema.parse(value);
  if (key.startsWith("scenario:")) {
    const v = scenarioSchema.parse(value);
    validateScenarioPortfolios(v);
    validateScenarioTax(v);
    validateMonthlySnapshot(v);
    if (key !== `scenario:${v.id}`)
      throw new Error("Scenario ID does not match.");
    return v;
  }
  if (key.startsWith("note:")) {
    const v = journalSchema.parse(value);
    if (key !== `note:${v.id}`) throw new Error("Note ID does not match.");
    return v;
  }
  throw new Error("Unsupported workspace entry.");
}
export function assetFromHolding(h: Holding): ScenarioAsset {
  const o = h.optionDetails;
  return {
    id: h.id,
    portfolioId: h.portfolioId,
    symbol: o?.underlying ?? h.symbol,
    label: o
      ? `${o.underlying} $${Number(o.strike)} ${o.right.toLowerCase()} · ${o.expiration.slice(0, 10)}`
      : h.symbol,
    quantity: h.quantity,
    currentValue: h.projection.currentMarketValue,
    costBasis: h.projection.costBasis,
    spot: o ? h.projection.underlyingPrice : h.projection.currentPrice,
    target: h.projection.hasTarget ? h.projection.targetUnderlyingPrice : null,
    quoteQuality: {
      estimated: h.projection.priceEstimated,
      stale: h.projection.quoteStale,
      asOf: h.projection.quoteAsOf,
      source: h.projection.quoteSource,
      ivEstimated: h.projection.ivEstimated,
    },
    option: o
      ? {
          strike: Number(o.strike),
          expiration: resolveOptionExpiry(
            o.expiration,
            o.underlying,
          ).modelExpirationAt.toISOString(),
          right: o.right,
          iv: h.projection.impliedVolatility ?? 0.6,
          multiplier: o.multiplier,
        }
      : null,
  };
}
export function valueAt(
  asset: ScenarioAsset,
  progress: number,
  mode: "model" | "intrinsic" = "model",
  assumptions: Assumptions = defaultAssumptions,
  at = Date.now(),
): number {
  if (asset.target == null) return asset.currentValue;
  const t = Math.min(1, Math.max(0, progress));
  if (t === 0) return asset.currentValue;
  if (assumptions.daysForward == null) return NaN;
  if (!asset.option)
    return currency(
      asset.currentValue +
        (asset.quantity * asset.target - asset.currentValue) * t,
    );
  const o = asset.option,
    direction = o.right === "CALL" ? 1 : -1;
  const intrinsic = (spot: number) =>
    Math.max(0, direction * (spot - o.strike)) * asset.quantity * o.multiplier;
  const targetIntrinsic = intrinsic(asset.target);
  if (mode === "intrinsic")
    return currency(
      asset.currentValue + (targetIntrinsic - asset.currentValue) * t,
    );
  const years = Math.max(
    0,
    (resolveOptionExpiry(
      o.expiration,
      asset.symbol,
    ).modelExpirationAt.getTime() -
      at -
      assumptions.daysForward * 86400000) /
      (365 * 86400000),
  );
  const model = (spot: number) =>
    blackScholesPrice({
      spot,
      strike: o.strike,
      timeToExpiryYears: years,
      riskFreeRate: assumptions.rate,
      volatility: assumptions.iv ?? o.iv,
      isCall: o.right === "CALL",
    }) *
    asset.quantity *
    o.multiplier;
  if (asset.spot == null)
    return currency(
      asset.currentValue + (model(asset.target) - asset.currentValue) * t,
    );
  const spot = asset.spot + (asset.target - asset.spot) * t;
  return currency(
    Math.max(
      0,
      model(spot) + (asset.currentValue - model(asset.spot)) * (1 - t),
    ),
  );
}
export function totalAt(
  assets: ScenarioAsset[],
  cash: number,
  progress: number,
  mode: "model" | "intrinsic" = "model",
  assumptions: Assumptions = defaultAssumptions,
  at = Date.now(),
) {
  return currency(
    cash +
      assets.reduce(
        (sum, a) => sum + valueAt(a, progress, mode, assumptions, at),
        0,
      ),
  );
}
export function snapshot(portfolios: Portfolio[], name: string): SavedScenario {
  return {
    id: crypto.randomUUID(),
    name,
    notes: "",
    capturedAt: new Date().toISOString(),
    expirationPolicy: optionExpiryPolicy,
    portfolioNames: portfolios.map((p) => p.name),
    portfolioSnapshots: portfolios.map((p) => ({
      id: p.id,
      name: p.name,
      cash: p.cashBalance,
      margin: resolveMarginSettings(p.margin),
    })),
    cash: portfolios.reduce((s, p) => s + p.cashBalance, 0),
    assets: portfolios.flatMap((p) => p.positions.map(assetFromHolding)),
    assumptions: { ...defaultAssumptions },
  };
}
export function csvCell(value: unknown) {
  const raw = String(value ?? "");
  // Keep numeric cash outflows usable as numbers; neutralize text formulas,
  // including formulas preceded by whitespace or spreadsheet control chars.
  const numeric = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw);
  const formula =
    !numeric &&
    (/^[\s\u0000-\u001f]*[=+@-]/.test(raw) || /^[\t\r\n]/.test(raw));
  return `"${(formula ? "'" : "") + raw.replaceAll('"', '""')}"`;
}
export function downloadText(
  text: string,
  filename: string,
  type = "text/plain",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
