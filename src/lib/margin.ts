import { z } from "zod";

export const marginSettingsSchema = z
  .object({
    debt: z
      .number()
      .finite()
      .min(0)
      .max(1e12)
      .multipleOf(0.01)
      .refine(
        (value) => Math.round(value * 100) / 100 === value,
        "Debt must use whole cents.",
      ),
    aprPercent: z.number().finite().min(0),
    maintenancePercent: z.number().finite().min(25).max(100),
    dayCountBasis: z.union([z.literal(360), z.literal(365)]),
  })
  .strict();

export type MarginSettings = z.infer<typeof marginSettingsSchema>;

export const defaultMarginSettings: MarginSettings = Object.freeze({
  debt: 0,
  aprPercent: 0,
  maintenancePercent: 25,
  dayCountBasis: 360,
});

/** Legacy omissions mean zero modeled debt; explicit malformed terms fail. */
export function resolveMarginSettings(
  input?: MarginSettings | null,
): MarginSettings {
  return input == null
    ? { ...defaultMarginSettings }
    : marginSettingsSchema.parse(input);
}

export type MarginSummary = {
  debt: number;
  grossValue: number;
  netEquity: number;
  marginEquity: number;
  maintenanceRequired: number;
  maintenanceExcess: number;
  maintenanceShortfall: number;
};

/**
 * Conservative scenario collateral: cash and equities, excluding long options.
 * Debt is an existing liability, never additional trading cash or buying power.
 * Current summaries use entered principal without backfilling interest.
 */
export function summarizeMargin(
  cash: number,
  equities: number,
  options: number,
  settings: MarginSettings = defaultMarginSettings,
): MarginSummary | null {
  if (
    ![cash, equities, options].every(
      (value) => Number.isFinite(value) && value >= 0,
    )
  )
    return null;
  const parsed = marginSettingsSchema.safeParse(settings);
  if (!parsed.success) return null;

  const { debt, maintenancePercent } = parsed.data;
  const grossValue = cash + equities + options;
  const marginEquity = cash + equities - debt;
  const maintenanceRequired = (maintenancePercent / 100) * equities;
  const maintenanceExcess = marginEquity - maintenanceRequired;
  const result: MarginSummary = {
    debt,
    grossValue,
    netEquity: grossValue - debt,
    marginEquity,
    maintenanceRequired,
    maintenanceExcess,
    maintenanceShortfall: Math.max(0, -maintenanceExcess),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

/** Sum shortfalls per account: another account's surplus cannot cure one. */
export function aggregateMargin(
  summaries: (MarginSummary | null)[],
): MarginSummary | null {
  const result: MarginSummary = {
    debt: 0,
    grossValue: 0,
    netEquity: 0,
    marginEquity: 0,
    maintenanceRequired: 0,
    maintenanceExcess: 0,
    maintenanceShortfall: 0,
  };
  const fields = Object.keys(result) as (keyof MarginSummary)[];
  for (const summary of summaries) {
    if (summary == null) return null;
    for (const field of fields) {
      if (!Number.isFinite(summary[field])) return null;
      result[field] += summary[field];
    }
  }
  return Object.values(result).every(Number.isFinite) ? result : null;
}

export type MarginDebtProjection = {
  principal: number;
  interest: number;
  outstandingDebt: number;
  elapsedDays: number;
};

/**
 * Daily-compounding scenario estimate for whole Eastern calendar days, with
 * frozen terms and no cash netting.
 * Principal is a liability; only newly accrued interest is a financing expense.
 * Return raw interest so the caller can round once per portfolio for display.
 */
export function projectMarginDebt(
  settings: MarginSettings,
  elapsedDays: number,
): MarginDebtProjection | null {
  if (!Number.isSafeInteger(elapsedDays) || elapsedDays < 0) return null;
  const parsed = marginSettingsSchema.safeParse(settings);
  if (!parsed.success) return null;
  const { debt: principal, aprPercent, dayCountBasis } = parsed.data;
  if (principal === 0 || aprPercent === 0 || elapsedDays === 0)
    return { principal, interest: 0, outstandingDebt: principal, elapsedDays };

  const dailyRate = aprPercent / 100 / dayCountBasis;
  const interest = principal * Math.expm1(elapsedDays * Math.log1p(dailyRate));
  const outstandingDebt = principal + interest;
  return Number.isFinite(interest) && Number.isFinite(outstandingDebt)
    ? { principal, interest, outstandingDebt, elapsedDays }
    : null;
}

function marginTimestamp(value: string | number): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (
    !Number.isFinite(timestamp) ||
    !Number.isFinite(new Date(timestamp).getTime())
  )
    return null;

  // Reject ISO calendar dates that Date.parse would silently normalize.
  if (typeof value === "string") {
    const calendar = /^((?:\d{4}|[+-]\d{6}))-(\d{2})-(\d{2})(?:$|[T\s])/.exec(
      value,
    );
    if (calendar) {
      const date = new Date(
        `${calendar[1]}-${calendar[2]}-${calendar[3]}T00:00:00.000Z`,
      );
      if (
        !Number.isFinite(date.getTime()) ||
        date.getUTCFullYear() !== Number(calendar[1]) ||
        date.getUTCMonth() + 1 !== Number(calendar[2]) ||
        date.getUTCDate() !== Number(calendar[3])
      )
        return null;
    }
  }
  return timestamp;
}

const marginDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  calendar: "gregory",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  era: "short",
});

function easternMarginDay(timestamp: number): number {
  const parts = marginDateFormatter.formatToParts(timestamp);
  const number = (type: "year" | "month" | "day") =>
    Number(parts.find((part) => part.type === type)?.value);
  const calendarYear = number("year");
  const year = parts.some((part) => part.type === "era" && part.value === "BC")
    ? 1 - calendarYear
    : calendarYear;
  let midnight = Date.UTC(year, number("month") - 1, number("day"));
  // Date.UTC treats years 0–99 as 1900–1999 unless explicitly corrected.
  if (year >= 0 && year < 100) {
    const date = new Date(midnight);
    date.setUTCFullYear(year, number("month") - 1, number("day"));
    midnight = date.getTime();
  }
  return midnight / 86400000;
}

/**
 * Whole Eastern calendar-date difference, including weekends, leap days and DST.
 * A later instant on the same Eastern date is zero days; backwards time fails.
 */
export function elapsedMarginDays(
  capturedAt: string | number,
  at: string | number,
): number | null {
  const captured = marginTimestamp(capturedAt);
  const projected = marginTimestamp(at);
  if (captured == null || projected == null || projected < captured)
    return null;
  const days = easternMarginDay(projected) - easternMarginDay(captured);
  return Number.isSafeInteger(days) && days >= 0 ? days : null;
}
