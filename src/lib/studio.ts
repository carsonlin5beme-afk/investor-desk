import { z } from "zod";
import type { Holding, Portfolio } from "./desk-types";
import { blackScholesPrice } from "@/server/domain/black-scholes";

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
  daysForward: finite.min(0).max(3650),
});
export type Assumptions = z.infer<typeof assumptionsSchema>;
export const defaultAssumptions: Assumptions = {
  rate: 0.04,
  iv: null,
  daysForward: 0,
};
export const scenarioSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  notes: z.string().max(4000),
  capturedAt: z.string().datetime(),
  portfolioNames: z.array(z.string().max(80)).max(100),
  cash: finite.nonnegative().max(1e20),
  assets: z.array(scenarioAssetSchema).max(2000),
  assumptions: assumptionsSchema,
});
export type SavedScenario = z.infer<typeof scenarioSchema>;
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
    option: o
      ? {
          strike: Number(o.strike),
          expiration: new Date(o.expiration).toISOString(),
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
    (new Date(o.expiration).getTime() -
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
    portfolioNames: portfolios.map((p) => p.name),
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
