import { monthlyValuationAt } from "./monthly-scenario";
import type { MonthlyResult } from "./monthly-projection";
import { resolveOptionExpiry } from "./option-expiration";
import { isTaxDate, taxCalendarDate, type TaxSale } from "./scenario-tax";
import { valueAt, type SavedScenario } from "./studio";

const day = 86400000;
const proceeds = (value: number | null | undefined): number | null => {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round((value + Number.EPSILON) * 100);
  return Number.isSafeInteger(cents) ? cents / 100 : null;
};

/** The sale uses the same instant as the target option and financing models. */
export function targetSaleAt(
  scenario: Pick<SavedScenario, "capturedAt" | "assumptions">,
): number | null {
  if (!taxCalendarDate(scenario.capturedAt)) return null;
  const forward = scenario.assumptions.daysForward;
  if (
    forward == null ||
    !Number.isFinite(forward) ||
    forward < 0 ||
    forward > 3650
  )
    return null;
  const at = Date.parse(scenario.capturedAt) + forward * day;
  return taxCalendarDate(at) ? at : null;
}
export const targetSaleDate = (
  scenario: Pick<SavedScenario, "capturedAt" | "assumptions">,
) => {
  const at = targetSaleAt(scenario);
  return at == null ? null : taxCalendarDate(at);
};

/** Date edits become model days, including Eastern DST, with no parallel tax date. */
export function targetDaysForSaleDate(
  scenario: Pick<SavedScenario, "capturedAt">,
  date: string | null,
): number | null {
  if (!date || !isTaxDate(date)) return null;
  const capturedDate = taxCalendarDate(scenario.capturedAt);
  if (!capturedDate || date < capturedDate) return null;
  const captured = Date.parse(scenario.capturedAt);
  const at = Math.max(captured, monthlyValuationAt(date));
  const forward = (at - captured) / day;
  return Number.isFinite(forward) && forward >= 0 && forward <= 3650
    ? forward
    : null;
}

export function targetTaxSales(
  scenario: SavedScenario,
  mode: "model" | "intrinsic" = "model",
  validSaleDate = true,
): TaxSale[] {
  const at = validSaleDate ? targetSaleAt(scenario) : null;
  const saleDate = at == null ? null : taxCalendarDate(at);
  return scenario.assets
    .filter((asset) => asset.quantity > 0)
    .map((asset) => {
      const base: TaxSale = {
        assetId: asset.id,
        label: asset.label,
        proceeds: null,
        saleDate,
      };
      if (!saleDate)
        return {
          ...base,
          reason:
            "Enter a valid sale date on or after capture, within the 10-year model horizon.",
        };
      if (asset.target == null)
        return {
          ...base,
          reason:
            "Enter this holding's target, or exclude it from the hypothetical sale.",
        };
      try {
        if (asset.option) {
          const expiry = resolveOptionExpiry(
            asset.option.expiration,
            asset.symbol,
          ).modelExpirationAt.getTime();
          if (expiry <= Date.parse(scenario.capturedAt))
            return {
              ...base,
              reason:
                "This option already expired at capture; it is not a new future sale.",
            };
          if (at! > expiry)
            return {
              ...base,
              reason:
                "The intended sale follows option expiration. Choose a sale on or before expiration, or use Monthly's dated expiry liquidation.",
            };
        }
        return {
          ...base,
          proceeds: proceeds(
            valueAt(
              asset,
              1,
              mode,
              scenario.assumptions,
              Date.parse(scenario.capturedAt),
            ),
          ),
        };
      } catch {
        return {
          ...base,
          reason:
            "The target sale value cannot be modeled from these assumptions.",
        };
      }
    });
}

/** One alternative liquidation per checkpoint; carried expiry cash is not sold again. */
export function monthlyTaxSales(
  scenario: SavedScenario,
  row?: MonthlyResult,
): TaxSale[] {
  return scenario.assets
    .filter((asset) => asset.quantity > 0)
    .map((asset) => {
      const position = row?.positions.find(
        (position) => position.id === asset.id,
      );
      const base: TaxSale = {
        assetId: asset.id,
        label: asset.label,
        proceeds: null,
        saleDate: row ? taxCalendarDate(row.at) : null,
      };
      if (!position || position.state === "unavailable")
        return {
          ...base,
          reason:
            position?.reason ??
            "The selected checkpoint has no sale projection.",
        };
      if (position.state === "liquidated") {
        const expiryDate = position.expiryAt
          ? taxCalendarDate(position.expiryAt)
          : null;
        if (
          !expiryDate ||
          Date.parse(position.expiryAt!) <= Date.parse(scenario.capturedAt)
        )
          return {
            ...base,
            reason:
              "This option expired before capture; its proceeds are not a new future realization.",
          };
        return {
          ...base,
          saleDate: expiryDate,
          proceeds: proceeds(position.expiryProceeds),
        };
      }
      return { ...base, proceeds: proceeds(position.holdingValue) };
    });
}
