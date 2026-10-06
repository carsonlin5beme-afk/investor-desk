"use client";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Download } from "lucide-react";
import { money } from "@/lib/desk-types";
import { downloadText, type ScenarioAsset } from "@/lib/studio";
import {
  createTaxSettings,
  projectScenarioTax,
  scenarioTaxSettingsSchema,
  isTaxDate,
  taxFilingLabels,
  taxFilingStatuses,
  taxTreatmentLabels,
  taxSources,
  type ScenarioTaxSettings,
  type TaxSale,
  type TaxTreatment,
  type TaxFilingStatus,
} from "@/lib/scenario-tax";
import styles from "./tax.module.css";

type Props = {
  assets: readonly ScenarioAsset[];
  settings?: ScenarioTaxSettings;
  sales: readonly TaxSale[];
  onChange: (settings: ScenarioTaxSettings) => void;
  scenarioId: string;
  capturedAt: string;
  context: string;
  saleDate?: string | null;
  onSaleDate?: (date: string | null) => void;
};

function amountFit(value: number | null | undefined): CSSProperties {
  return {
    "--tax-value-fit": `${160 / money(value).length}cqi`,
  } as CSSProperties;
}

export function TaxTracker(props: Props) {
  if (!props.settings)
    return (
      <section
        className={`panel ${styles.root}`}
        aria-label="Hypothetical target-sale tax"
      >
        <h3>Hypothetical target-sale tax</h3>
        <p className="muted">
          Explore federal tax if you liquidate selected holdings. Start with
          gains as your only income, then enter acquisition dates and review
          assumed basis and treatment.
        </p>
        <button
          className="button secondary"
          onClick={() =>
            props.onChange(
              createTaxSettings(props.assets.filter((a) => a.quantity > 0)),
            )
          }
        >
          Set up tax estimate
        </button>
        <p className="fine-print">
          This planning tool does not realize gains, reserve cash, or place
          orders.
        </p>
      </section>
    );
  return (
    <TaxEditor key={props.scenarioId} {...props} settings={props.settings} />
  );
}

function TaxEditor({
  assets,
  settings,
  sales,
  onChange,
  scenarioId,
  capturedAt,
  context,
  saleDate,
  onSaleDate,
}: Props & { settings: ScenarioTaxSettings }) {
  const [income, setIncome] = useState(
    settings.otherOrdinaryIncome == null
      ? ""
      : String(settings.otherOrdinaryIncome),
  );
  const [bases, setBases] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      settings.assumptions.map((a) => [
        a.assetId,
        a.totalBasis == null ? "" : String(a.totalBasis),
      ]),
    ),
  );
  const [notice, setNotice] = useState("");
  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    if (JSON.stringify(settings) === lastEmitted.current) return;
    setIncome(
      settings.otherOrdinaryIncome == null
        ? ""
        : String(settings.otherOrdinaryIncome),
    );
    setBases(
      Object.fromEntries(
        settings.assumptions.map((a) => [
          a.assetId,
          a.totalBasis == null ? "" : String(a.totalBasis),
        ]),
      ),
    );
  }, [settings]);
  const emit = (next: ScenarioTaxSettings) => {
    lastEmitted.current = JSON.stringify(next);
    onChange(next);
  };
  const fieldAmount = (raw: string): number | null => {
    if (!raw.trim()) return null;
    const candidate = Number(raw);
    return Number.isFinite(candidate) &&
      candidate >= 0 &&
      candidate <= 1e12 &&
      Math.round(candidate * 100) / 100 === candidate
      ? candidate
      : null;
  };
  const invalid = (raw: string) =>
    Boolean(raw.trim()) && fieldAmount(raw) == null;
  const update = (
    id: string,
    partial: Partial<ScenarioTaxSettings["assumptions"][number]>,
  ) =>
    emit({
      ...settings,
      assumptions: settings.assumptions.map((a) =>
        a.assetId === id ? { ...a, ...partial } : a,
      ),
    });
  const projection = useMemo(
    () => projectScenarioTax(settings, sales),
    [settings, sales],
  );
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const saleById = new Map(sales.map((sale) => [sale.assetId, sale]));
  const years = [
    ...new Set(
      sales
        .filter((sale) =>
          settings.assumptions.some(
            (a) => a.assetId === sale.assetId && a.included,
          ),
        )
        .flatMap((sale) =>
          sale.saleDate && isTaxDate(sale.saleDate)
            ? [Number(sale.saleDate.slice(0, 4))]
            : [],
        ),
    ),
  ].sort();
  const short = projection.complete
    ? projection.years.reduce((sum, year) => sum + year.shortTermGains, 0)
    : null;
  const long = projection.complete
    ? projection.years.reduce((sum, year) => sum + year.longTermGains, 0)
    : null;
  const afterReserve =
    projection.proceeds == null || projection.taxReserve == null
      ? null
      : Math.round((projection.proceeds - projection.taxReserve) * 100) / 100;
  const amountRows: [string, number | null][] = [
    ["Gross sale proceeds", projection.proceeds],
    ["Short-term gain / loss", short],
    ["Long-term gain / loss", long],
    ["Tax change from these sales", projection.taxChange],
    ["Regular federal + NIIT reserve", projection.taxReserve],
    ["Modeled tax reduction", projection.modeledTaxReduction],
    ["Proceeds after tax reserve", afterReserve],
    ["Gain after tax reserve", projection.afterTaxGain],
  ];
  function exportSnapshot() {
    try {
      downloadText(
        JSON.stringify(
          {
            version: 1,
            scope: "Hypothetical target-sale federal tax",
            scenarioId,
            capturedAt,
            context,
            assumedSaleDate: saleDate ?? null,
            settings,
            sales,
            projection,
            financingTreatment:
              "Margin debt and interest are excluded from taxable-gain adjustments.",
            sources: taxSources,
          },
          null,
          2,
        ),
        `investor-desk-${scenarioId}-tax.json`,
        "application/json",
      );
      setNotice("Tax snapshot exported with exact values and assumptions.");
    } catch {
      setNotice("Unable to export this tax snapshot. Please try again.");
    }
  }
  return (
    <section
      className={`panel ${styles.root}`}
      aria-label="Hypothetical target-sale tax"
    >
      <div className={styles.heading}>
        <div>
          <h3>Hypothetical target-sale tax</h3>
          <p className="muted">{context}</p>
        </div>
        <span className="badge subtle">U.S. federal planning estimate</span>
      </div>
      <p className="fine-print">
        Assumes a taxable individual account, an adult not claimed as a
        dependent, and the basic standard deduction. Estimates regular U.S.
        federal tax plus Net Investment Income Tax (NIIT); excludes state/local
        taxes, AMT, credits and special tax treatments.
      </p>
      <p className="fine-print">
        Each checkpoint is an alternative liquidation, not another sale of the
        same holding. Gross asset proceeds determine capital gains; margin debt
        and financing interest do not reduce assumed tax basis or taxable gains
        here.
      </p>
      <div className={styles.settings}>
        <label>
          Tax rules year
          <select
            value={settings.rulesYear}
            onChange={(e) =>
              emit({
                ...settings,
                rulesYear: Number(e.target.value) as 2025 | 2026,
              })
            }
          >
            <option value={2026}>2026 IRS rules</option>
            <option value={2025}>2025 IRS rules</option>
          </select>
        </label>
        <label>
          Filing status
          <select
            value={settings.filingStatus}
            onChange={(e) =>
              emit({
                ...settings,
                filingStatus: e.target.value as TaxFilingStatus,
              })
            }
          >
            {taxFilingStatuses.map((status) => (
              <option value={status} key={status}>
                {taxFilingLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Other annual ordinary income ($)
          <input
            type="number"
            className="financial-number private-value"
            min="0"
            max="1000000000000"
            step="0.01"
            value={income}
            aria-invalid={invalid(income)}
            onChange={(e) => {
              const raw = e.target.value;
              setIncome(raw);
              emit({ ...settings, otherOrdinaryIncome: fieldAmount(raw) });
            }}
          />
        </label>
        {onSaleDate && (
          <label>
            Assumed sale date
            <input
              type="date"
              value={saleDate ?? ""}
              onChange={(e) =>
                onSaleDate(isTaxDate(e.target.value) ? e.target.value : null)
              }
            />
          </label>
        )}
      </div>
      <p className="fine-print">
        Other income defaults to $0, so modeled gains are your only income. It
        is an annual non-investment ordinary-income assumption for each sale
        year, excluding other investment income.
      </p>
      {invalid(income) && (
        <p className="error-box" role="alert">
          Enter other income as a finite nonnegative amount in whole cents.
        </p>
      )}
      {years
        .filter((year) => year !== settings.rulesYear)
        .map((year) => (
          <p className={styles.notice} role="status" key={year}>
            {year} sale modeled using frozen {settings.rulesYear} rules. These
            are a planning assumption, not published rules for the sale year.
          </p>
        ))}
      <div className={styles.holdings}>
        {settings.assumptions.map((assumption) => {
          const asset = assetById.get(assumption.assetId),
            sale = saleById.get(assumption.assetId),
            row = projection.rows.find(
              (row) => row.assetId === assumption.assetId,
            );
          const label = asset?.label ?? sale?.label ?? assumption.assetId;
          return (
            <article key={assumption.assetId} className={styles.holding}>
              <div className={styles.heading}>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={assumption.included}
                    aria-label={`Include ${label} in tax estimate`}
                    onChange={(e) =>
                      update(assumption.assetId, { included: e.target.checked })
                    }
                  />
                  <strong>{label}</strong>
                </label>
                <span>
                  {row?.included && row.term
                    ? row.term === "long"
                      ? "Long-term"
                      : "Short-term"
                    : assumption.included
                      ? "Needs assumptions"
                      : "Excluded"}
                </span>
              </div>
              <div className={styles.settings}>
                <label>
                  Assumed acquisition date
                  <input
                    type="date"
                    aria-label={`${label} acquisition date`}
                    value={assumption.acquiredDate ?? ""}
                    disabled={!assumption.included}
                    onChange={(e) =>
                      update(assumption.assetId, {
                        acquiredDate: isTaxDate(e.target.value)
                          ? e.target.value
                          : null,
                      })
                    }
                  />
                </label>
                <label>
                  Assumed total tax basis ($)
                  <input
                    type="number"
                    className="financial-number private-value"
                    min="0"
                    max="1000000000000"
                    step="0.01"
                    aria-label={`${label} total tax basis`}
                    aria-invalid={invalid(bases[assumption.assetId] ?? "")}
                    value={bases[assumption.assetId] ?? ""}
                    disabled={!assumption.included}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setBases((old) => ({
                        ...old,
                        [assumption.assetId]: raw,
                      }));
                      update(assumption.assetId, {
                        totalBasis: fieldAmount(raw),
                      });
                    }}
                  />
                </label>
                <label>
                  Assumed tax treatment
                  <select
                    aria-label={`${label} tax treatment`}
                    value={assumption.treatment}
                    disabled={!assumption.included}
                    onChange={(e) =>
                      update(assumption.assetId, {
                        treatment: e.target.value as TaxTreatment,
                      })
                    }
                  >
                    {(["unknown", "standard", "unsupported"] as const).map(
                      (t) => (
                        <option key={t} value={t}>
                          {taxTreatmentLabels[t]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              <p className="fine-print">
                One date assumes this entire aggregate holding was acquired
                together; mixed lots are unsupported. Total basis is prefilled
                from captured cost as a planning assumption and already includes
                quantity{asset?.option ? " and contract multiplier" : ""}.
                Review or override it.
              </p>
              {asset?.option && (
                <p className="fine-print">
                  Supported treatment assumes a standalone purchased equity
                  option sold or hypothetically closed at the shown date.
                  Section 1256/index options, protective puts, straddles,
                  written options and physical exercise/assignment are outside
                  this estimate. The expiry intrinsic-proceeds proxy is a
                  hypothetical liquidation, counted once in its shown year.
                </p>
              )}
              <dl className={styles.rowValues}>
                <div>
                  <dt>Hypothetical sale date</dt>
                  <dd>{sale?.saleDate ?? "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Gross proceeds</dt>
                  <dd
                    className="private-value"
                    style={amountFit(sale?.proceeds)}
                  >
                    {money(sale?.proceeds)}
                  </dd>
                </div>
                <div>
                  <dt>Assumed gain / loss</dt>
                  <dd className="private-value" style={amountFit(row?.gain)}>
                    {money(row?.gain)}
                  </dd>
                </div>
              </dl>
              {assumption.included &&
                invalid(bases[assumption.assetId] ?? "") && (
                  <p className="error-box" role="alert">
                    Enter {label} basis as a finite nonnegative amount in whole
                    cents.
                  </p>
                )}
              {row?.included && row.issue && (
                <p className={styles.notice}>{row.issue}</p>
              )}
            </article>
          );
        })}
      </div>
      {!projection.complete && (
        <p className={styles.notice} role="status">
          Tax estimate unavailable. {projection.issue}{" "}
          {projection.missingCount > 0
            ? `${projection.missingCount} included holding or input${projection.missingCount === 1 ? "" : "s"} needs review.`
            : ""}
        </p>
      )}
      {!settings.assumptions.some((a) => a.included) && (
        <p className="fine-print">
          No holdings are selected, so no hypothetical sales are modeled.
        </p>
      )}
      <dl className={styles.totals} aria-label="Tax planning totals">
        {amountRows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd
              className="financial-number private-value"
              style={amountFit(value)}
            >
              {money(value)}
            </dd>
          </div>
        ))}
      </dl>
      {projection.years.map((year) => (
        <details key={year.saleYear} className={styles.annual}>
          <summary>
            {year.saleYear} realization · {year.rulesYear} rules · tax reserve{" "}
            <span className={`financial-number private-value ${styles.amount}`}>
              {money(year.taxReserve)}
            </span>
          </summary>
          <dl className={styles.totals}>
            {[
              ["Short-term gain / loss", year.shortTermGains],
              ["Long-term gain / loss", year.longTermGains],
              ["Basic standard deduction", year.standardDeduction],
              ["Taxable ordinary income", year.taxableOrdinaryIncome],
              ["Taxable long-term gains", year.taxableLongTermGains],
              ["Regular federal estimate", year.regularTax],
              ["Net Investment Income Tax", year.niit],
              ["Tax without these sales", year.baselineTax],
              ["Tax with these sales", year.annualTax],
              ["Change caused by sales", year.taxChange],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{String(label)}</dt>
                <dd
                  className="financial-number private-value"
                  style={amountFit(value as number)}
                >
                  {money(value as number)}
                </dd>
              </div>
            ))}
          </dl>
          <dl className={styles.totals}>
            <div>
              <dt>Top modeled ordinary marginal rate</dt>
              <dd className="financial-number private-value">
                {Math.round(year.ordinaryTopRate * 100)}%
              </dd>
            </div>
            <div>
              <dt>Top modeled long-term gain rate</dt>
              <dd className="financial-number private-value">
                {Math.round(year.longTermTopRate * 100)}%
              </dd>
            </div>
          </dl>
          <p className="fine-print">
            Marginal rates apply to slices of taxable income, not the entire
            gain. Ordinary income and long-term gains use separate brackets.
          </p>
          <p className="fine-print">
            Annual netting and income stacking determine tax. The standard
            deduction is applied once for this year. The reserve is the positive
            difference from tax without these sales; existing income tax is not
            reserved twice.
          </p>
        </details>
      ))}
      <details className={styles.policy}>
        <summary>Assumptions, limits and IRS sources</summary>
        <p className="fine-print">
          Taxable individual account; adult not claimed as a dependent; basic
          standard deduction; ordinary capital assets and non-investment other
          income. Regular federal marginal slices plus restricted NIIT are a
          planning estimate. State/local taxes, AMT, credits, extra
          age/blind/senior deductions, dependent/kiddie tax, qualified
          dividends, other investment income, itemizing, retirement accounts,
          foreign adjustments, special-rate gains, corporate actions, wash sales
          and loss carryovers are not calculated. A modeled tax reduction is not
          a promised refund; no carryforward is inferred.
        </p>
        <p className="fine-print">
          Sales are grouped by realization year using the selected frozen rules.
          Net short-term and long-term gains/losses offset before rates apply.
          Long-term means more than one calendar year after acquisition; unknown
          dates or unsupported treatments remain unavailable.
        </p>
        <ul>
          {taxSources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.label}
              </a>
            </li>
          ))}
        </ul>
      </details>
      <div className={styles.export}>
        <button
          className="button secondary"
          onClick={exportSnapshot}
          disabled={!scenarioTaxSettingsSchema.safeParse(settings).success}
        >
          <Download size={15} /> Tax snapshot JSON
        </button>
        <p className="fine-print">
          Export includes exact values and assumptions. Monetary privacy masking
          applies to readouts, not this file.
        </p>
      </div>
      {notice && (
        <p className="fine-print" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
