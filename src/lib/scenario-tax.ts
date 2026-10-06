import { z } from "zod";

export const taxFilingStatuses = [
  "single",
  "marriedJoint",
  "marriedSeparate",
  "headOfHousehold",
  "survivingSpouse",
] as const;
export type TaxFilingStatus = (typeof taxFilingStatuses)[number];
export type TaxRuleYear = 2025 | 2026;
export type TaxTerm = "short" | "long";
export type TaxTreatment = "standard" | "unknown" | "unsupported";
export const taxTreatmentLabels: Record<TaxTreatment, string> = {
  standard: "Ordinary stock/ETF or purchased equity option",
  unknown: "Choose tax treatment",
  unsupported: "Special treatment — outside this estimate",
};
export const taxFilingLabels: Record<TaxFilingStatus, string> = {
  single: "Single",
  marriedJoint: "Married filing jointly",
  marriedSeparate: "Married filing separately",
  headOfHousehold: "Head of household",
  survivingSpouse: "Qualifying surviving spouse",
};

type TaxRules = {
  ordinaryBounds: readonly number[];
  deduction: number;
  capitalBounds: readonly [number, number];
  niitThreshold: number;
};
const rules = (
  ordinaryBounds: readonly number[],
  deduction: number,
  capitalBounds: readonly [number, number],
  niitThreshold: number,
): TaxRules => ({ ordinaryBounds, deduction, capitalBounds, niitThreshold });

// IRS Rev. Proc. 2024-40 §§2.01/2.03, with amended 2025 deduction
// in Rev. Proc. 2025-32 §3.01; 2026 tables in §§4.01/4.03/4.14.
export const federalTaxRules: Record<
  TaxRuleYear,
  Record<TaxFilingStatus, TaxRules>
> = {
  2025: {
    single: rules(
      [11925, 48475, 103350, 197300, 250525, 626350],
      15750,
      [48350, 533400],
      200000,
    ),
    marriedJoint: rules(
      [23850, 96950, 206700, 394600, 501050, 751600],
      31500,
      [96700, 600050],
      250000,
    ),
    marriedSeparate: rules(
      [11925, 48475, 103350, 197300, 250525, 375800],
      15750,
      [48350, 300000],
      125000,
    ),
    headOfHousehold: rules(
      [17000, 64850, 103350, 197300, 250500, 626350],
      23625,
      [64750, 566700],
      200000,
    ),
    survivingSpouse: rules(
      [23850, 96950, 206700, 394600, 501050, 751600],
      31500,
      [96700, 600050],
      250000,
    ),
  },
  2026: {
    single: rules(
      [12400, 50400, 105700, 201775, 256225, 640600],
      16100,
      [49450, 545500],
      200000,
    ),
    marriedJoint: rules(
      [24800, 100800, 211400, 403550, 512450, 768700],
      32200,
      [98900, 613700],
      250000,
    ),
    marriedSeparate: rules(
      [12400, 50400, 105700, 201775, 256225, 384350],
      16100,
      [49450, 306850],
      125000,
    ),
    headOfHousehold: rules(
      [17700, 67450, 105700, 201750, 256200, 640600],
      24150,
      [66200, 579600],
      200000,
    ),
    survivingSpouse: rules(
      [24800, 100800, 211400, 403550, 512450, 768700],
      32200,
      [98900, 613700],
      250000,
    ),
  },
};

export const taxSources = [
  {
    label: "IRS 2026 rules and amended 2025 deductions",
    url: "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
  },
  { label: "IRS 2025 brackets", url: "https://www.irs.gov/irb/2024-45_IRB" },
  {
    label: "IRS capital gains and holding periods",
    url: "https://www.irs.gov/taxtopics/tc409",
  },
  {
    label: "IRS Net Investment Income Tax",
    url: "https://www.irs.gov/individuals/net-investment-income-tax",
  },
];

export function isTaxDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000 || year > 9999) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Scenario dates are Eastern calendar dates; literal dates need no timezone conversion. */
export function taxCalendarDate(value: string | number): string | null {
  if (isTaxDate(value)) return value;
  if (
    typeof value === "string" &&
    !z.string().datetime({ offset: true }).safeParse(value).success
  )
    return null;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const result = `${get("year")}-${get("month")}-${get("day")}`;
  return isTaxDate(result) ? result : null;
}

/** IRS: begin after acquisition, include trade date, and require MORE than one year. */
export function capitalGainTerm(
  acquired: string,
  sold: string,
): TaxTerm | null {
  if (!isTaxDate(acquired) || !isTaxDate(sold) || sold < acquired) return null;
  const years = Number(sold.slice(0, 4)) - Number(acquired.slice(0, 4));
  return years > 1 || (years === 1 && sold.slice(5) > acquired.slice(5))
    ? "long"
    : "short";
}

const amount = z
  .number()
  .finite()
  .nonnegative()
  .max(1e12)
  .multipleOf(0.01)
  .refine(
    (value) => Math.round(value * 100) / 100 === value,
    "Use whole cents.",
  );
export const taxHoldingAssumptionSchema = z
  .object({
    assetId: z.string().min(1).max(150),
    included: z.boolean(),
    treatment: z
      .enum(["standard", "unknown", "unsupported"])
      .default("unknown"),
    acquiredDate: z
      .string()
      .refine(isTaxDate, "Enter a valid acquisition date.")
      .nullable(),
    totalBasis: amount.nullable(),
  })
  .strict();
export const scenarioTaxSettingsSchema = z
  .object({
    rulesYear: z.union([z.literal(2025), z.literal(2026)]),
    filingStatus: z.enum(taxFilingStatuses),
    otherOrdinaryIncome: amount.nullable(),
    assumptions: z.array(taxHoldingAssumptionSchema).max(2000),
  })
  .strict()
  .superRefine((settings, ctx) => {
    if (
      new Set(settings.assumptions.map((a) => a.assetId)).size !==
      settings.assumptions.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assumptions"],
        message: "Tax holding IDs must be unique.",
      });
    }
  });
export type ScenarioTaxSettings = z.infer<typeof scenarioTaxSettingsSchema>;
export function createTaxSettings(
  assets: readonly { id: string; costBasis: number }[],
): ScenarioTaxSettings {
  return {
    rulesYear: 2026,
    filingStatus: "single",
    otherOrdinaryIncome: 0,
    assumptions: assets.map((asset) => ({
      assetId: asset.id,
      included: true,
      treatment: "unknown",
      acquiredDate: null,
      totalBasis: amount.safeParse(asset.costBasis).success
        ? asset.costBasis
        : null,
    })),
  };
}

const cents = (value: number): number | null => {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round((value + Math.sign(value) * Number.EPSILON) * 100);
  return Number.isSafeInteger(rounded) ? rounded : null;
};
const cash = (value: number): number | null => {
  const rounded = cents(value);
  return rounded == null ? null : rounded / 100;
};
function sum(values: readonly number[]): number | null {
  const parts = values.map(cents);
  if (parts.some((part) => part == null)) return null;
  let total = 0;
  for (const part of parts) {
    total += part!;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total / 100;
}
export type TaxBand = { rate: number; amount: number; tax: number };
function bands(
  value: number,
  lower: number,
  bounds: readonly number[],
  rates: readonly number[],
): TaxBand[] {
  let start = 0;
  return rates.flatMap((rate, index) => {
    const end = bounds[index] ?? Infinity;
    const allocation = Math.max(
      0,
      Math.min(lower + value, end) - Math.max(lower, start),
    );
    start = end;
    return allocation > 0
      ? [{ rate, amount: allocation, tax: allocation * rate }]
      : [];
  });
}
const ordinaryRates = [0.1, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
const bandTax = (values: TaxBand[]) =>
  values.reduce((total, value) => total + value.tax, 0);

export type FederalTaxEstimate = {
  rulesYear: TaxRuleYear;
  filingStatus: TaxFilingStatus;
  shortTermGains: number;
  longTermGains: number;
  netCapitalGain: number;
  capitalLossDeduction: number;
  adjustedGrossIncome: number;
  standardDeduction: number;
  taxableIncome: number;
  taxableOrdinaryIncome: number;
  taxableLongTermGains: number;
  ordinaryBands: TaxBand[];
  longTermBands: TaxBand[];
  ordinaryTopRate: number;
  longTermTopRate: number;
  regularTax: number;
  niit: number;
  annualTax: number;
  baselineTax: number;
  taxChange: number;
  taxReserve: number;
  modeledTaxReduction: number;
  afterTaxGain: number;
};

/** Restricted regular-federal + NIIT model, without credits, AMT or carryovers. */
export function estimateFederalTax(input: {
  rulesYear: TaxRuleYear;
  filingStatus: TaxFilingStatus;
  otherOrdinaryIncome: number;
  shortTermGains: number;
  longTermGains: number;
}): FederalTaxEstimate | null {
  const table = federalTaxRules[input.rulesYear]?.[input.filingStatus];
  if (!table || !amount.safeParse(input.otherOrdinaryIncome).success)
    return null;
  if (
    [input.shortTermGains, input.longTermGains].some(
      (value) => cents(value) == null,
    )
  )
    return null;
  const net = sum([input.shortTermGains, input.longTermGains]);
  if (net == null) return null;
  // Offset opposite characters before preferential treatment (Schedule D).
  const preferred = Math.max(0, Math.min(input.longTermGains, net));
  const lossDeduction =
    net < 0
      ? Math.min(-net, input.filingStatus === "marriedSeparate" ? 1500 : 3000)
      : 0;
  const recognized = net >= 0 ? net : -lossDeduction;
  const agi = sum([input.otherOrdinaryIncome, recognized]);
  if (agi == null) return null;
  const taxable = Math.max(0, agi - table.deduction);
  const taxablePreferred = Math.min(preferred, taxable);
  const taxableOrdinary = taxable - taxablePreferred;
  const ordinaryBands = bands(
    taxableOrdinary,
    0,
    table.ordinaryBounds,
    ordinaryRates,
  );
  const longTermBands = bands(
    taxablePreferred,
    taxableOrdinary,
    table.capitalBounds,
    [0, 0.15, 0.2],
  );
  const regular = Math.min(
    bandTax(ordinaryBands) + bandTax(longTermBands),
    bandTax(bands(taxable, 0, table.ordinaryBounds, ordinaryRates)),
  );
  // In this restricted model, otherOrdinaryIncome is NON-investment income;
  // MAGI equals modeled AGI. The standard deduction does not reduce MAGI.
  const niit =
    0.038 * Math.min(Math.max(0, net), Math.max(0, agi - table.niitThreshold));
  const annualTax = cash(regular + niit);
  const baselineTax = cash(
    bandTax(
      bands(
        Math.max(0, input.otherOrdinaryIncome - table.deduction),
        0,
        table.ordinaryBounds,
        ordinaryRates,
      ),
    ),
  );
  if (annualTax == null || baselineTax == null) return null;
  const taxChange = sum([annualTax, -baselineTax]);
  if (taxChange == null) return null;
  const taxReserve = Math.max(0, taxChange);
  const afterTaxGain = sum([net, -taxReserve]);
  if (afterTaxGain == null) return null;
  return {
    rulesYear: input.rulesYear,
    filingStatus: input.filingStatus,
    shortTermGains: input.shortTermGains,
    longTermGains: input.longTermGains,
    netCapitalGain: net,
    capitalLossDeduction: lossDeduction,
    adjustedGrossIncome: agi,
    standardDeduction: table.deduction,
    taxableIncome: taxable,
    taxableOrdinaryIncome: taxableOrdinary,
    taxableLongTermGains: taxablePreferred,
    ordinaryBands,
    longTermBands,
    ordinaryTopRate: ordinaryBands.at(-1)?.rate ?? 0,
    longTermTopRate: longTermBands.at(-1)?.rate ?? 0,
    regularTax: cash(regular)!,
    niit: cash(niit)!,
    annualTax,
    baselineTax,
    taxChange,
    taxReserve,
    modeledTaxReduction: Math.max(0, -taxChange),
    afterTaxGain,
  };
}

export type TaxSale = {
  assetId: string;
  label: string;
  proceeds: number | null;
  saleDate: string | null;
  reason?: string | null;
};
export type TaxSaleRow = TaxSale & {
  included: boolean;
  treatment: TaxTreatment;
  acquiredDate: string | null;
  totalBasis: number | null;
  gain: number | null;
  term: TaxTerm | null;
  issue: string | null;
};
export type ScenarioTaxProjection = {
  complete: boolean;
  rows: TaxSaleRow[];
  years: (FederalTaxEstimate & {
    saleYear: number;
    usesAssumedRules: boolean;
  })[];
  gain: number | null;
  proceeds: number | null;
  taxReserve: number | null;
  taxChange: number | null;
  modeledTaxReduction: number | null;
  afterTaxGain: number | null;
  missingCount: number;
  issue: string | null;
};

/** No partial account tax totals: missing sales can change every tax bracket. */
export function projectScenarioTax(
  settings: ScenarioTaxSettings,
  sales: readonly TaxSale[],
): ScenarioTaxProjection {
  const unavailable = (
    rows: TaxSaleRow[],
    issue: string,
    missingCount = 1,
  ): ScenarioTaxProjection => ({
    complete: false,
    rows,
    years: [],
    gain: null,
    proceeds: null,
    taxReserve: null,
    taxChange: null,
    modeledTaxReduction: null,
    afterTaxGain: null,
    missingCount,
    issue,
  });
  const checked = scenarioTaxSettingsSchema.safeParse(settings);
  if (!checked.success)
    return unavailable(
      [],
      checked.error.issues[0]?.message ?? "Tax settings are invalid.",
    );
  if (
    sales.length > 2000 ||
    new Set(sales.map((sale) => sale.assetId)).size !== sales.length
  )
    return unavailable(
      [],
      "Sale holding IDs must be unique and within the scenario limit.",
    );
  const config = checked.data;
  const byId = new Map(sales.map((sale) => [sale.assetId, sale]));
  const rows: TaxSaleRow[] = config.assumptions.map((assumption) => {
    const sale = byId.get(assumption.assetId) ?? {
      assetId: assumption.assetId,
      label: assumption.assetId,
      proceeds: null,
      saleDate: null,
    };
    const base = {
      ...sale,
      ...assumption,
      gain: null,
      term: null,
      issue: null,
    };
    if (!assumption.included) return base;
    const term =
      assumption.acquiredDate && sale.saleDate
        ? capitalGainTerm(assumption.acquiredDate, sale.saleDate)
        : null;
    let issue: string | null = null;
    if (!byId.has(assumption.assetId))
      issue = "This holding has no sale projection.";
    else if (sale.reason) issue = sale.reason;
    else if (assumption.treatment === "unknown")
      issue = "Choose the holding's assumed tax treatment.";
    else if (assumption.treatment === "unsupported")
      issue = "This holding's special tax treatment is outside this estimate.";
    else if (
      sale.proceeds == null ||
      sale.proceeds < 0 ||
      cents(sale.proceeds) == null
    )
      issue = "Sale proceeds are unavailable.";
    else if (assumption.totalBasis == null)
      issue = "Enter an assumed total tax basis.";
    else if (!assumption.acquiredDate)
      issue = "Enter an assumed acquisition date.";
    else if (!sale.saleDate || !isTaxDate(sale.saleDate))
      issue = "The sale date is unavailable.";
    else if (!term) issue = "Acquisition must be on or before the sale date.";
    const gain = issue ? null : sum([sale.proceeds!, -assumption.totalBasis!]);
    if (!issue && gain == null)
      issue = "The gain exceeds the calculation range.";
    return {
      ...base,
      term: assumption.treatment === "standard" ? term : null,
      gain,
      issue,
    };
  });
  if (
    sales.some(
      (sale) => !config.assumptions.some((a) => a.assetId === sale.assetId),
    )
  )
    return unavailable(
      rows,
      "Tax assumptions are missing for a scenario holding.",
    );
  const missingCount = rows.filter((row) => row.included && row.issue).length;
  if (missingCount)
    return unavailable(
      rows,
      "Complete the included holdings' sale, basis, acquisition and tax-treatment assumptions.",
      missingCount,
    );
  if (config.otherOrdinaryIncome == null)
    return unavailable(
      rows,
      "Enter other annual ordinary income, including 0.",
    );
  const included = rows.filter((row) => row.included);
  const yearGroups = new Map<number, TaxSaleRow[]>();
  for (const row of included) {
    const year = Number(row.saleDate!.slice(0, 4));
    yearGroups.set(year, [...(yearGroups.get(year) ?? []), row]);
  }
  const years: ScenarioTaxProjection["years"] = [];
  for (const [saleYear, group] of [...yearGroups].sort(([a], [b]) => a - b)) {
    const shortTermGains = sum(
      group.filter((row) => row.term === "short").map((row) => row.gain!),
    );
    const longTermGains = sum(
      group.filter((row) => row.term === "long").map((row) => row.gain!),
    );
    if (shortTermGains == null || longTermGains == null)
      return unavailable(rows, "Annual gains exceed the calculation range.");
    const estimate = estimateFederalTax({
      ...config,
      otherOrdinaryIncome: config.otherOrdinaryIncome,
      shortTermGains,
      longTermGains,
    });
    if (!estimate)
      return unavailable(rows, "Annual tax exceeds the calculation range.");
    years.push({
      ...estimate,
      saleYear,
      usesAssumedRules: saleYear !== config.rulesYear,
    });
  }
  const totals = {
    gain: sum(included.map((row) => row.gain!)),
    proceeds: sum(included.map((row) => row.proceeds!)),
    taxReserve: sum(years.map((year) => year.taxReserve)),
    taxChange: sum(years.map((year) => year.taxChange)),
    modeledTaxReduction: sum(years.map((year) => year.modeledTaxReduction)),
    afterTaxGain: sum(years.map((year) => year.afterTaxGain)),
  };
  if (Object.values(totals).some((value) => value == null))
    return unavailable(rows, "Scenario totals exceed the calculation range.");
  return {
    complete: true,
    rows,
    years,
    ...totals,
    missingCount: 0,
    issue: null,
  };
}
