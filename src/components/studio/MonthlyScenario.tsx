"use client";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { z } from "zod";
import { CalendarDays, Copy, Plus, Save, Trash2 } from "lucide-react";
import { money, num, type Portfolio } from "@/lib/desk-types";
import {
  scenarioSchema,
  snapshot,
  validateWorkspaceValue,
  type SavedScenario,
} from "@/lib/studio";
import {
  createMonthlyPlan,
  capturedPriceAnchor,
  monthlyDraftPlanSchema,
  monthlyInputNumber,
  monthlyTargetInputs,
  monthlyTargetLimits,
  nextMonthEnd,
  resolveMonthlyTarget,
  supportsMonthlyValuation,
  underlyingSymbol,
  type MonthlyPlan,
  type MonthlyTargetInputs,
} from "@/lib/monthly-scenario";
import { expiryPrice, projectMonthly } from "@/lib/monthly-projection";
import { resolveOptionExpiry } from "@/lib/option-expiration";
import { SaveState } from "./Controls";
import { MonthlyChart } from "./MonthlyChart";
import { useSessionDraft } from "./useSessionDraft";
import type { WorkspaceController } from "./useWorkspace";
import styles from "./monthly.module.css";

const draftSchema = scenarioSchema.extend({
  name: z.string().max(80),
  monthly: monthlyDraftPlanSchema.optional(),
});
const parseDraft = (value: unknown) => withMonthly(draftSchema.parse(value));
const monthLabel = (date: string, short = false) =>
  new Intl.DateTimeFormat("en-US", {
    month: short ? "short" : "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  }).format(new Date(value.length === 10 ? `${value}T16:00:00Z` : value));
const inputNumber = (value: string) => (value === "" ? null : Number(value));
const signed = (value: number | null) =>
  value == null ? "Incomplete" : `${value > 0 ? "+" : ""}${money(value)}`;
const valueClass = (value: number | null | undefined) =>
  `financial-number private-value ${value == null ? styles.unavailable : value < 0 ? `negative ${styles.loss}` : value === 0 ? styles.neutral : ""}`;
// Fit the complete formatted amount within its card; never split currency digits.
const amountStyle = (text: string): CSSProperties =>
  ({ "--amount-fit": `${160 / text.length}cqi` }) as CSSProperties;

function withMonthly(scenario: SavedScenario): SavedScenario {
  return {
    ...scenario,
    monthly:
      scenario.monthly ??
      createMonthlyPlan(scenario.assets, scenario.capturedAt),
  };
}

export function MonthlyScenario({
  portfolios,
  workspace,
}: {
  portfolios: Portfolio[];
  workspace: WorkspaceController;
}) {
  const [draft, setDraft] = useSessionDraft<SavedScenario>(
    `investor-desk:${workspace.identity}:monthly-scenario-draft`,
    parseDraft,
  );
  const current = useMemo(
    () => withMonthly(snapshot(portfolios, "Monthly price path")),
    [portfolios],
  );
  const working = draft ?? current,
    plan = working.monthly!;
  const activePaths = plan.paths.filter((path) =>
    working.assets.some(
      (asset) =>
        asset.quantity > 0 && underlyingSymbol(asset.symbol) === path.symbol,
    ),
  );
  const anchors = new Map(
    activePaths.map((path) => [
      path.symbol,
      capturedPriceAnchor(working.assets, path.symbol),
    ]),
  );
  const [selected, setSelected] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const [deleted, setDeleted] = useState<SavedScenario | null>(null);
  const revision = useRef(0);
  const month = Math.min(selected, plan.dates.length - 1);
  const entries = workspace.entries
    .filter((entry) => entry.key.startsWith("scenario:"))
    .map((entry) => entry.value as SavedScenario);
  const persisted = entries.some((entry) => entry.id === working.id);
  const calculation = useMemo(() => {
    try {
      return { rows: projectMonthly(working), error: "" };
    } catch (error) {
      return {
        rows: [],
        error:
          error instanceof z.ZodError
            ? error.issues[0]?.message
            : (error as Error).message,
      };
    }
  }, [working.assets, working.cash, working.capturedAt, working.monthly]);
  const row = calculation.rows[month];
  const open = (scenario: SavedScenario) => {
    revision.current++;
    setDraft(withMonthly(structuredClone(scenario)));
    setSelected(0);
    setSaved(false);
    setError("");
  };
  const change = (partial: Partial<SavedScenario>) => {
    revision.current++;
    setDraft({ ...working, ...partial });
    setSaved(false);
    setError("");
  };
  const changePlan = (partial: Partial<MonthlyPlan>) =>
    change({ monthly: { ...plan, ...partial } });
  const changeTarget = (
    symbol: string,
    partial: Partial<MonthlyTargetInputs>,
  ) =>
    changePlan({
      paths: plan.paths.map((path) => {
        if (path.symbol !== symbol) return path;
        const inputs = { ...monthlyTargetInputs(path), ...partial };
        return {
          ...path,
          targetInputs: inputs,
          prices: inputs.priceInputs.map((raw) => {
            const value = monthlyInputNumber(raw);
            return value != null &&
              Number.isFinite(value) &&
              value >= 0 &&
              value <= monthlyTargetLimits.price
              ? value
              : null;
          }),
        };
      }),
    });
  async function save() {
    setBusy(true);
    setError("");
    const version = revision.current;
    try {
      const value = validateWorkspaceValue(
        `scenario:${working.id}`,
        working,
      ) as SavedScenario;
      await workspace.save(`scenario:${value.id}`, value);
      if (revision.current === version) {
        setDraft(value);
        setSaved(true);
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const expiries = [
    ...new Map(
      working.assets.flatMap((asset) =>
        asset.option && asset.quantity > 0
          ? [
              [
                `${underlyingSymbol(asset.symbol)}:${asset.option.expiration.slice(0, 10)}`,
                {
                  symbol: underlyingSymbol(asset.symbol),
                  expiry: resolveOptionExpiry(
                    asset.option.expiration,
                    underlyingSymbol(asset.symbol),
                  ),
                },
              ] as const,
            ]
          : [],
      ),
    ).values(),
  ].sort(
    (a, b) =>
      a.expiry.modelExpirationAt.getTime() -
      b.expiry.modelExpirationAt.getTime(),
  );
  const snapshotValue =
    working.cash +
    working.assets.reduce(
      (total, asset) => total + (asset.quantity === 0 ? 0 : asset.currentValue),
      0,
    );
  const basis = working.assets.reduce(
    (total, asset) => total + (asset.quantity === 0 ? 0 : asset.costBasis),
    0,
  );
  const quoteWarnings = working.assets.filter(
    (asset) =>
      asset.quantity > 0 &&
      (!asset.quoteQuality ||
        asset.quoteQuality.estimated ||
        asset.quoteQuality.stale ||
        (asset.option && asset.quoteQuality.ivEstimated)),
  );
  return (
    <section className={`studio-page ${styles.root}`}>
      {workspace.error && (
        <div className="error-box" role="alert">
          {workspace.error}{" "}
          <button
            className="text-button"
            onClick={() => void workspace.reload()}
          >
            Reload saved scenarios
          </button>
        </div>
      )}
      <div className={styles.library}>
        <label>
          Open saved scenario
          <select
            aria-label="Open saved scenario"
            value={persisted ? working.id : ""}
            disabled={workspace.loading || busy}
            onChange={(event) => {
              const scenario = entries.find(
                (entry) => entry.id === event.target.value,
              );
              if (scenario) open(scenario);
            }}
          >
            <option value="">
              {workspace.loading
                ? "Loading scenarios…"
                : "Current draft / new scenario"}
            </option>
            {entries.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
                {entry.monthly ? " · Monthly" : " · Target snapshot"}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button primary"
          disabled={!portfolios.length || workspace.loading || busy}
          onClick={() =>
            open(snapshot(portfolios, `Monthly scenario ${entries.length + 1}`))
          }
        >
          <Plus size={16} /> New monthly scenario
        </button>
        {draft && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              revision.current++;
              setDraft(null);
              setSelected(0);
              setSaved(false);
              setError("");
            }}
          >
            Use current holdings
          </button>
        )}
        <button
          className="text-button"
          disabled={busy || (!working.assets.length && !portfolios.length)}
          onClick={() =>
            open({
              ...working,
              id: crypto.randomUUID(),
              name: `${working.name.slice(0, 70)} copy`,
            })
          }
        >
          <Copy size={15} /> Duplicate
        </button>
        {persisted && (
          <button
            className="text-button"
            disabled={busy}
            aria-label={`Delete ${working.name}`}
            onClick={async () => {
              setBusy(true);
              try {
                await workspace.remove(`scenario:${working.id}`);
                setDeleted(working);
                setDraft(null);
                setSaved(false);
                setError("");
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 size={15} /> Delete
          </button>
        )}
      </div>
      {deleted && (
        <div className="undo-banner" role="status">
          <span>“{deleted.name}” removed.</span>
          <button
            className="text-button"
            onClick={async () => {
              try {
                await workspace.save(`scenario:${deleted.id}`, deleted);
                open(deleted);
                setDeleted(null);
              } catch (error) {
                setError((error as Error).message);
              }
            }}
          >
            Undo delete
          </button>
        </div>
      )}
      {!working.assets.length && !portfolios.length && !draft ? (
        <div className="panel empty-state">
          <CalendarDays size={28} />
          <h3>A price path starts with a portfolio.</h3>
          <p>
            Create a portfolio and add holdings in your overview, then explore
            their monthly value here.
          </p>
        </div>
      ) : (
        <>
          <div className={`panel ${styles.overview} ${styles.selection}`}>
            <div className={styles.topline}>
              <label>
                Scenario name
                <input
                  value={working.name}
                  maxLength={80}
                  onChange={(event) => change({ name: event.target.value })}
                />
              </label>
              <span className="fine-print">
                Snapshot · {dateLabel(working.capturedAt)}
                <br />
                {working.portfolioNames.join(", ") || "No holdings"}
              </span>
            </div>
            <div
              className={styles.months}
              role="group"
              aria-label="Monthly checkpoints"
            >
              {plan.dates.map((date, index) => (
                <button
                  key={date}
                  type="button"
                  aria-pressed={month === index}
                  data-month={date}
                  onClick={() => setSelected(index)}
                  onKeyDown={(event) => {
                    if (
                      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    )
                      return;
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? plan.dates.length - 1
                          : (index +
                              (event.key === "ArrowRight" ? 1 : -1) +
                              plan.dates.length) %
                            plan.dates.length;
                    setSelected(next);
                    (
                      event.currentTarget.parentElement?.children[
                        next
                      ] as HTMLButtonElement
                    )?.focus();
                  }}
                >
                  <span>{monthLabel(date, true)}</span>
                  <strong
                    className={valueClass(calculation.rows[index]?.total)}
                  >
                    {calculation.rows[index]?.total == null
                      ? "Incomplete"
                      : money(calculation.rows[index].total, 0)}
                  </strong>
                </button>
              ))}
            </div>
          </div>
          <div className={styles.sectionTitle}>
            <h2>{monthLabel(plan.dates[month])}</h2>
            <span className="muted">
              Valued {dateLabel(plan.dates[month])} at 4 pm New York
            </span>
          </div>
          <dl
            className={styles.totals}
            data-wide-values={[
              money(row?.total),
              signed(row?.profit ?? null),
              signed(row?.change ?? null),
            ].some((value) => value.length > 14)}
            aria-label={`${monthLabel(plan.dates[month])} totals`}
          >
            <div>
              <dt>Portfolio value</dt>
              <dd
                className={valueClass(row?.total)}
                data-testid="monthly-total"
                style={amountStyle(
                  row?.total == null ? "Incomplete" : money(row.total),
                )}
              >
                {row?.total == null ? "Incomplete" : money(row.total)}
              </dd>
              <small>Cash + shares + options + expiry proceeds</small>
            </div>
            <div>
              <dt>Modeled profit vs cost</dt>
              <dd
                className={valueClass(row?.profit)}
                data-testid="monthly-profit"
                style={amountStyle(signed(row?.profit ?? null))}
              >
                {signed(row?.profit ?? null)}
              </dd>
              <small>
                Original holding cost ·{" "}
                <span className="private-value">{money(basis)}</span>
              </small>
            </div>
            <div>
              <dt>Change vs snapshot</dt>
              <dd
                className={valueClass(row?.change)}
                data-testid="monthly-change"
                style={amountStyle(signed(row?.change ?? null))}
              >
                {signed(row?.change ?? null)}
              </dd>
              <small>
                Captured {dateLabel(working.capturedAt)} ·{" "}
                <span className="private-value">
                  {row?.changePercent == null
                    ? "—"
                    : `${row.changePercent >= 0 ? "+" : ""}${row.changePercent.toFixed(1)}%`}
                </span>
              </small>
            </div>
          </dl>
          <div className={styles.horizon}>
            <span className="fine-print">
              Calendar month-end · 4 pm New York · planning dates, including
              weekends
            </span>
            <button
              className="text-button"
              disabled={plan.dates.length >= 24}
              onClick={() =>
                changePlan({
                  dates: [...plan.dates, nextMonthEnd(plan.dates.at(-1)!)],
                  paths: plan.paths.map((path) => ({
                    ...path,
                    prices: [...path.prices, path.prices.at(-1) ?? null],
                    ...(path.targetInputs && {
                      targetInputs: {
                        ...path.targetInputs,
                        priceInputs: [
                          ...path.targetInputs.priceInputs,
                          path.targetInputs.priceInputs.at(-1) ?? "",
                        ],
                        marketCapInputs: [
                          ...path.targetInputs.marketCapInputs,
                          path.targetInputs.marketCapInputs.at(-1) ?? "",
                        ],
                      },
                    }),
                  })),
                })
              }
            >
              <Plus size={14} /> Add month
            </button>
          </div>
          {row && row.missingCount > 0 && (
            <p className={styles.notice} role="status">
              {row.missingCount} holding
              {row.missingCount === 1 ? " needs" : "s need"} an input or cannot
              be modeled. Known subtotal:{" "}
              <span className="private-value">{money(row.knownSubtotal)}</span>;
              this is not your full portfolio total.
            </p>
          )}
          {row?.unavailableReason && (
            <p className={styles.notice} role="status">
              {row.unavailableReason}
            </p>
          )}
          <div className={styles.editGrid}>
            <section className={`panel ${styles.editor}`}>
              <h3>Company targets for {monthLabel(plan.dates[month], true)}</h3>
              <p className="fine-print">
                Choose stock price or company valuation (market cap). Each
                company’s target applies to its shares and every option on the
                same underlying. Blank means incomplete, not $0.
              </p>
              {activePaths.length ? (
                activePaths.map((path) => {
                  const inputs = monthlyTargetInputs(path);
                  const valuation = inputs.mode === "valuation";
                  const resolved = resolveMonthlyTarget(path, month);
                  return (
                    <div className={styles.priceRow} key={path.symbol}>
                      <span>
                        <strong>{path.symbol}</strong>
                        <small>
                          {
                            working.assets.filter(
                              (asset) =>
                                asset.quantity > 0 &&
                                underlyingSymbol(asset.symbol) === path.symbol,
                            ).length
                          }{" "}
                          holding(s) share this path
                        </small>
                        {anchors.get(path.symbol)?.conflict && (
                          <small className={styles.warning}>
                            Captured prices differ. Enter this month’s shared
                            price and review the starting anchor in Model
                            assumptions.
                          </small>
                        )}
                        {anchors.get(path.symbol)?.unsupported && (
                          <small className={styles.warning}>
                            A captured price exceeds the supported range. Enter
                            a supported monthly assumption and review the
                            starting anchor.
                          </small>
                        )}
                      </span>
                      <div className={styles.targetFields}>
                        <label>
                          <span className={styles.inputLabel}>
                            Target type · all months
                          </span>
                          <select
                            aria-label={`${path.symbol} target type`}
                            value={inputs.mode}
                            onChange={(event) =>
                              changeTarget(path.symbol, {
                                mode: event.target
                                  .value as MonthlyTargetInputs["mode"],
                              })
                            }
                          >
                            <option value="price">Stock price</option>
                            <option
                              value="valuation"
                              disabled={!supportsMonthlyValuation(path.symbol)}
                            >
                              Company valuation (market cap)
                            </option>
                          </select>
                        </label>
                        {!supportsMonthlyValuation(path.symbol) && (
                          <small>Use share price for this fund.</small>
                        )}
                        <label>
                          <span className={styles.inputLabel}>
                            {valuation
                              ? "Company valuation / market cap"
                              : `${path.symbol} stock price`}{" "}
                            ($)
                          </span>
                          <input
                            aria-label={`${path.symbol} ${valuation ? "company valuation" : "price"} in ${monthLabel(plan.dates[month])}`}
                            className="financial-number private-value"
                            type="text"
                            inputMode="decimal"
                            maxLength={64}
                            value={
                              (valuation
                                ? inputs.marketCapInputs
                                : inputs.priceInputs)[month]
                            }
                            placeholder={
                              valuation
                                ? "Enter full USD valuation"
                                : "Enter a price"
                            }
                            onChange={(event) =>
                              changeTarget(
                                path.symbol,
                                valuation
                                  ? {
                                      marketCapInputs:
                                        inputs.marketCapInputs.map(
                                          (value, index) =>
                                            index === month
                                              ? event.target.value
                                              : value,
                                        ),
                                    }
                                  : {
                                      priceInputs: inputs.priceInputs.map(
                                        (value, index) =>
                                          index === month
                                            ? event.target.value
                                            : value,
                                      ),
                                    },
                              )
                            }
                          />
                        </label>
                        {valuation && (
                          <>
                            <label>
                              <span className={styles.inputLabel}>
                                Shares outstanding · manual assumption
                              </span>
                              <input
                                aria-label={`${path.symbol} shares outstanding`}
                                className="financial-number private-value"
                                type="text"
                                inputMode="numeric"
                                maxLength={64}
                                value={inputs.sharesOutstandingInput}
                                placeholder="Enter total company shares"
                                onChange={(event) =>
                                  changeTarget(path.symbol, {
                                    sharesOutstandingInput: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <small>
                              A positive whole-company share count, held
                              constant across this path. This is your
                              assumption, not a live fundamental.
                            </small>
                            <small
                              className={
                                resolved.price == null ? styles.warning : ""
                              }
                              role="status"
                            >
                              {resolved.price == null ? (
                                resolved.reason
                              ) : (
                                <>
                                  Implied stock price:{" "}
                                  <span className="financial-number private-value">
                                    {money(resolved.price)}
                                  </span>{" "}
                                  · market cap ÷ shares outstanding
                                </>
                              )}
                            </small>
                            <small>
                              Enter USD, up to{" "}
                              {money(monthlyTargetLimits.marketCap, 0)}. For
                              funds, use share price.
                            </small>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="muted">
                  This snapshot contains cash only. Cash stays constant across
                  months.
                </p>
              )}
            </section>
            <section className={`panel ${styles.editor}`}>
              <h3>What makes up the total</h3>
              <dl
                className={styles.composition}
                data-wide-values={[
                  row ? row.cash : working.cash,
                  row?.equities,
                  row?.options,
                  row?.expiryProceeds,
                ].some((value) => money(value).length > 14)}
              >
                <div>
                  <dt>Starting cash</dt>
                  <dd
                    className="financial-number private-value"
                    style={amountStyle(money(row ? row.cash : working.cash))}
                  >
                    {money(row ? row.cash : working.cash)}
                  </dd>
                </div>
                <div>
                  <dt>Shares</dt>
                  <dd
                    className="financial-number private-value"
                    style={amountStyle(money(row?.equities))}
                  >
                    {money(row?.equities)}
                  </dd>
                </div>
                <div>
                  <dt>Unexpired options · model</dt>
                  <dd
                    className="financial-number private-value"
                    style={amountStyle(money(row?.options))}
                  >
                    {money(row?.options)}
                  </dd>
                </div>
                <div>
                  <dt>Hypothetical expiry proceeds</dt>
                  <dd
                    className="financial-number private-value"
                    style={amountStyle(money(row?.expiryProceeds))}
                  >
                    {money(row?.expiryProceeds)}
                  </dd>
                </div>
              </dl>
              <p className={styles.policy}>
                At expiry, assume liquidation at intrinsic value and carry the
                proceeds unchanged. The expiry price is interpolated between
                adjacent dated inputs unless you override it below. This does
                not exercise contracts or change your portfolio’s cash.
              </p>
            </section>
          </div>
          {calculation.error && (
            <p className="error-box" role="alert">
              Check the scenario inputs: {calculation.error}
            </p>
          )}
          <div className={`panel ${styles.footer}`}>
            <div>
              <SaveState busy={busy} error={error} saved={saved} />
              <p className="fine-print">
                Drafts stay in this tab. Save to retain monthly inputs and
                assumptions in your{" "}
                {workspace.identity?.startsWith("guest")
                  ? "temporary guest workspace"
                  : "workspace"}
                .
              </p>
            </div>
            <button
              className="button primary"
              disabled={
                busy ||
                workspace.loading ||
                !working.name.trim() ||
                Boolean(calculation.error)
              }
              onClick={() => void save()}
            >
              <Save size={16} />
              {busy ? "Saving…" : "Save monthly scenario"}
            </button>
          </div>
          <section className={`panel ${styles.overview}`}>
            <h3>Captured baseline and price path</h3>
            <div className={styles.baseline}>
              <span>
                Captured portfolio{" "}
                <strong className="financial-number private-value">
                  {money(snapshotValue)}
                </strong>
              </span>
              <span>
                Holdings cost{" "}
                <strong className="financial-number private-value">
                  {money(basis)}
                </strong>
              </span>
              <span>
                Starting cash{" "}
                <strong className="financial-number private-value">
                  {money(working.cash)}
                </strong>
              </span>
            </div>
            <p className="fine-print">
              Future rows are model estimates, not today’s option quotes. Profit
              compares holdings with their original cost; change compares the
              portfolio with this captured value. Neither is income or a
              guaranteed return.
            </p>
            {quoteWarnings.length > 0 && (
              <p className={styles.notice} role="status">
                {quoteWarnings.length} holding
                {quoteWarnings.length === 1 ? " has" : "s have"} stale,
                estimated or undocumented quote/IV inputs. See each holding’s
                detail below. Snapshot comparisons retain those limitations.
              </p>
            )}
            {!calculation.error && (
              <MonthlyChart rows={calculation.rows} selected={month} />
            )}
          </section>
          <details className={`panel ${styles.assumptions}`}>
            <summary>
              Model assumptions · {(plan.rate * 100).toFixed(1)}% rate ·{" "}
              {plan.ivOverride == null
                ? "captured / estimated IV"
                : `${num(plan.ivOverride * 100)}% IV`}{" "}
              · zero dividends
            </summary>
            <div className={styles.assumptionFields}>
              <label>
                Interest rate (%)
                <input
                  className="financial-number private-value"
                  type="number"
                  min={-10}
                  max={50}
                  step="0.1"
                  value={plan.rate * 100}
                  onChange={(event) =>
                    changePlan({ rate: Number(event.target.value) / 100 })
                  }
                />
              </label>
              <label>
                IV override (%)
                <input
                  className="financial-number private-value"
                  type="number"
                  min={1}
                  max={500}
                  step="1"
                  value={plan.ivOverride == null ? "" : plan.ivOverride * 100}
                  placeholder="Use captured IV"
                  onChange={(event) =>
                    changePlan({
                      ivOverride:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value) / 100,
                    })
                  }
                />
              </label>
            </div>
            <p className="fine-print">
              European Black–Scholes approximation for long options before
              expiry; actual calendar-day time remaining, a 365-day year, no
              dividends, fees, early exercise or reinvestment. The default 4%
              rate is an assumption. American equity options can behave
              differently, and issuers may pay dividends. Captured or estimated
              IV remains fixed unless overridden.
            </p>
            <h4>Price at capture · interpolation anchor</h4>
            <p className="fine-print">
              Used only when expiry falls before the first monthly checkpoint.
              Changing this assumption does not replace the captured portfolio
              value.
            </p>
            <div className={styles.assumptionFields}>
              {activePaths.map((path) => (
                <label key={path.symbol}>
                  {path.symbol} at capture ($)
                  <input
                    className="financial-number private-value"
                    type="number"
                    min={0}
                    max={1e9}
                    step="any"
                    value={path.initialPrice ?? ""}
                    onChange={(event) =>
                      changePlan({
                        paths: plan.paths.map((item) =>
                          item.symbol === path.symbol
                            ? {
                                ...item,
                                initialPrice: inputNumber(event.target.value),
                              }
                            : item,
                        ),
                      })
                    }
                  />
                  {anchors.get(path.symbol)?.conflict && (
                    <small className={styles.warning}>
                      Captured prices differ for {path.symbol}:{" "}
                      <span className="private-value">
                        {anchors
                          .get(path.symbol)!
                          .prices.map((price) => `$${num(price)}`)
                          .join(", ")}
                      </span>
                      .
                      {path.initialPrice == null ? (
                        " Enter a shared starting price or an explicit expiry price if an option expires before the first checkpoint."
                      ) : (
                        <>
                          {" "}
                          This plan uses{" "}
                          <span className="private-value">
                            ${num(path.initialPrice)}
                          </span>{" "}
                          as its shared starting assumption. Saved monthly
                          inputs are retained.
                        </>
                      )}
                    </small>
                  )}
                </label>
              ))}
            </div>
          </details>
          {expiries.length > 0 && (
            <details className={`panel ${styles.assumptions}`}>
              <summary>
                Expiry prices · shared by underlying and expiration
              </summary>
              <p className="fine-print">
                Linear interpolation uses elapsed time between the two adjacent
                price checkpoints. Missing endpoints are never skipped or
                extrapolated. An explicit expiry price resolves only that
                expiry. Already-expired snapshot holdings stay unavailable
                because their proceeds may already be in starting cash.
              </p>
              {expiries.map(({ symbol, expiry }) => {
                const date = expiry.expirationDate,
                  alreadyExpired =
                    expiry.modelExpirationAt.getTime() <=
                    Date.parse(working.capturedAt);
                const terminal = expiryPrice(
                  plan,
                  symbol,
                  expiry.modelExpirationAt.getTime(),
                  Date.parse(working.capturedAt),
                );
                const override = plan.expiryPrices.find(
                  (point) => point.symbol === symbol && point.date === date,
                );
                return (
                  <label className={styles.priceRow} key={`${symbol}:${date}`}>
                    <span>
                      <strong>
                        {symbol} · {dateLabel(date)}
                      </strong>
                      <small className="private-value">
                        {alreadyExpired
                          ? "Already expired at capture · unavailable"
                          : `${terminal.source === "override" ? "Override" : "Interpolated"}: ${terminal.price == null ? "needs adjacent prices" : `$${num(terminal.price)}`}`}{" "}
                        ·{" "}
                        {expiry.modelExpirationAt.toLocaleTimeString("en-US", {
                          timeZone: "America/New_York",
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        New York
                      </small>
                    </span>
                    <span>
                      <span className={styles.inputLabel}>
                        Underlying price at expiry ($)
                      </span>
                      <input
                        aria-label={`${symbol} expiry price on ${date}`}
                        disabled={alreadyExpired}
                        className="financial-number private-value"
                        type="number"
                        min={0}
                        max={1e9}
                        step="any"
                        value={override?.price ?? ""}
                        placeholder="Use interpolation"
                        onChange={(event) =>
                          changePlan({
                            expiryPrices: [
                              ...plan.expiryPrices.filter(
                                (point) =>
                                  point.symbol !== symbol ||
                                  point.date !== date,
                              ),
                              {
                                symbol,
                                date,
                                price: inputNumber(event.target.value),
                              },
                            ],
                          })
                        }
                      />
                    </span>
                  </label>
                );
              })}
            </details>
          )}
          <section className={`panel ${styles.editor}`}>
            <h3>Holdings in {monthLabel(plan.dates[month])}</h3>
            <p className="fine-print">
              Intrinsic is shown beside the option model. Expired positions
              retain proceeds once, with no option holding left to reprice.
            </p>
            <div
              className={styles.tableWrap}
              tabIndex={0}
              role="region"
              aria-label="Monthly holding breakdown"
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Holding</th>
                    <th scope="col">Holding value</th>
                    <th scope="col">Expiry proceeds</th>
                    <th scope="col">Modeled profit vs cost</th>
                  </tr>
                </thead>
                <tbody>
                  {row?.positions.map((position) => (
                    <tr key={position.id}>
                      <th scope="row">
                        <strong className="private-value">
                          {position.label}
                        </strong>
                        <small className="private-value">
                          {num(position.quantity)}{" "}
                          {position.kind === "option" ? "contracts" : "shares"}{" "}
                          · cost {money(position.cost)}
                        </small>
                        {position.state === "model" && (
                          <small className="private-value">
                            Intrinsic {money(position.intrinsic)} · IV{" "}
                            {num(position.iv! * 100)}%
                            {position.ivEstimated
                              ? " (estimated / source unknown)"
                              : plan.ivOverride == null
                                ? " (captured)"
                                : " (override)"}
                          </small>
                        )}
                        {position.state === "liquidated" && (
                          <small className="private-value">
                            Liquidated in this model · expiry underlying $
                            {num(position.expirySpot!)} ({position.expirySource}
                            )
                          </small>
                        )}
                        {position.reason && (
                          <small className={styles.problem}>
                            {position.reason}
                          </small>
                        )}
                        {position.warnings.map((warning) => (
                          <small className={styles.warning} key={warning}>
                            {warning}
                          </small>
                        ))}
                      </th>
                      <td className="financial-number private-value">
                        {money(position.holdingValue)}
                      </td>
                      <td className="financial-number private-value">
                        {money(position.expiryProceeds)}
                      </td>
                      <td className={valueClass(position.profit)}>
                        {signed(position.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {row?.positions.length === 0 && (
              <p className="muted">No positions in this snapshot.</p>
            )}
          </section>
          <section className={`panel ${styles.editor}`}>
            <label>
              Scenario notes
              <textarea
                rows={2}
                maxLength={4000}
                value={working.notes}
                onChange={(event) => change({ notes: event.target.value })}
                placeholder="What would have to happen for this price path?"
              />
            </label>
          </section>
        </>
      )}
      {error && !working.assets.length && !portfolios.length && !draft && (
        <p className="error-box" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
