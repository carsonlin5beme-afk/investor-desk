import type { Portfolio as StoredPortfolio } from "@prisma/client";
import { toDecimal, toNumber } from "@/lib/decimal";
import {
  defaultMarginSettings,
  marginSettingsSchema,
  summarizeMargin,
  type MarginSettings,
} from "@/lib/margin";

type StoredMargin = Partial<
  Pick<
    StoredPortfolio,
    | "marginDebt"
    | "marginAprPercent"
    | "marginMaintenancePercent"
    | "marginDayCountBasis"
  >
>;

/** Missing fields belong to an older guest session; they imply zero debt. */
export function portfolioMarginSettings(
  portfolio: StoredMargin,
): MarginSettings {
  return marginSettingsSchema.parse({
    debt: toNumber(portfolio.marginDebt),
    aprPercent: portfolio.marginAprPercent ?? defaultMarginSettings.aprPercent,
    maintenancePercent:
      portfolio.marginMaintenancePercent ??
      defaultMarginSettings.maintenancePercent,
    dayCountBasis:
      portfolio.marginDayCountBasis ?? defaultMarginSettings.dayCountBasis,
  });
}

export function marginStorage(margin: MarginSettings) {
  const settings = marginSettingsSchema.parse(margin);
  return {
    marginDebt: toDecimal(settings.debt),
    marginAprPercent: settings.aprPercent,
    marginMaintenancePercent: settings.maintenancePercent,
    marginDayCountBasis: settings.dayCountBasis,
  };
}

/** Gross assets and the entered liability remain distinct in every presenter. */
export function portfolioValues(
  cash: number,
  equities: number,
  options: number,
  margin: MarginSettings,
) {
  const marginSummary = summarizeMargin(cash, equities, options, margin);
  if (!marginSummary)
    throw new Error("Portfolio margin values are unavailable.");
  return {
    margin,
    marginSummary,
    grossCurrentValue: marginSummary.grossValue,
    netEquity: marginSummary.netEquity,
    currentValue: marginSummary.netEquity,
  };
}
