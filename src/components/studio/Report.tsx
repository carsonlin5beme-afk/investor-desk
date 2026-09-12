"use client";
import { useId, useMemo, useRef, useState } from "react";
import { Download, Printer, FileJson } from "lucide-react";
import { DeskModal } from "@/components/DeskModal";
import { type Portfolio, type Holding, money, num } from "@/lib/desk-types";
import {
  csvCell,
  downloadText,
  assetFromHolding,
  totalAt,
  valueAt,
  defaultAssumptions,
} from "@/lib/studio";
import styles from "./report.module.css";

const printStyles = `
  :root{color-scheme:light}*{box-sizing:border-box}body{font:14px/1.6 Arial,sans-serif;color:#183d30;margin:40px;background:#fff;overflow-wrap:anywhere}
  h1,h2{font-family:Georgia,serif;font-weight:400;line-height:1.15}h1{font-size:46px;margin:16px 0}h2{font-size:24px;margin:0 0 16px}
  .eyebrow{font-size:11px;letter-spacing:.16em}.report-meta,.fine-print,small{font-size:11px;color:#50665b}
  .report-kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin:30px 0;padding:22px 0;border-block:1px solid #dce4db}
  .report-kpis>div{min-width:0}.report-kpis strong{display:block;overflow-wrap:anywhere;font-size:25px;font-weight:500;letter-spacing:-.04em}.report-kpis span{font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:10px}thead{display:table-header-group}td,th{text-align:left;border-bottom:1px solid #dce4db;padding:10px 7px;overflow-wrap:anywhere}th{font-weight:600}small{display:block;font-size:9px}
  .report-footer{margin-top:30px;border-top:1px solid #dce4db;padding-top:20px}.report-allocation>div{display:flex;justify-content:space-between;gap:8px 20px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid #dce4db}
  section{margin:26px 0}.report-kpis,tr,.${styles.chart},.${styles.legend}{break-inside:avoid}h2{break-after:avoid}
  .${styles.chart}{margin:0;padding:18px 16px 14px;border:1px solid #dce4db;border-radius:8px;background:#f8faf6;color:#50665b}
  .${styles.graph}{height:215px;position:relative;font:11px/1.3 Arial,sans-serif}.${styles.axis}{position:absolute;inset:0 auto 30px 0;width:84px;display:flex;flex-direction:column;justify-content:space-between;text-align:right;padding-right:12px}
  .${styles.plot}{position:absolute;inset:6px 0 36px 84px}.${styles.plot}>svg{width:100%;height:100%;display:block;overflow:visible}.${styles.plot} text{font-family:Arial,sans-serif}
  .${styles.labels}{position:absolute;inset:auto 0 0 84px;display:flex;justify-content:space-between;gap:10px}
  .${styles.legend}{display:flex;flex-wrap:wrap;gap:14px 20px;margin:18px 0 10px;font-size:11px}.${styles.legend}>span{display:flex;align-items:center;gap:7px}
  .${styles.swatch}{display:inline-block;width:20px;border-top:2px solid;margin-right:7px;vertical-align:middle}.${styles.caption}{font-size:11px;line-height:1.6;margin:12px 0 0}
  [data-print-controls]{padding:12px 16px;background:#f4f6f0;border-radius:6px;margin-bottom:25px;font:12px/1.5 Arial,sans-serif}[data-print-controls] button{margin-right:12px;padding:8px 14px;background:#183d30;color:white;border:0;border-radius:5px;cursor:pointer}
  @page{size:auto;margin:17mm}@media print{body{margin:0}.table-scroll{overflow:visible}[data-print-controls]{display:none}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

function printFontStyles() {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.type === CSSRule.FONT_FACE_RULE) rules.push(rule.cssText);
      }
    } catch {
      // Cross-origin stylesheets need not be readable for a printable brief.
    }
  }
  const rootStyle = getComputedStyle(document.documentElement);
  const ui = rootStyle.getPropertyValue("--font-ui").trim();
  const editorial = rootStyle.getPropertyValue("--font-editorial").trim();
  return `${rules.join("\n")}body{font-family:${ui || "Arial,sans-serif"}}h1,h2{font-family:${editorial || "Georgia,serif"}}`;
}

export function Report({
  portfolios: incomingPortfolios,
  filtered: incomingFiltered,
  asOf: incomingAsOf,
  mode: incomingMode,
  initialMasked = false,
  close,
}: {
  portfolios: Portfolio[];
  filtered: Holding[];
  asOf: string;
  mode: string;
  initialMasked?: boolean;
  close: () => void;
}) {
  // A brief is one consistent capture, including while the desk polls for prices.
  const [{ portfolios, filtered, asOf, mode, at }] = useState(() => ({
    portfolios: incomingPortfolios,
    filtered: incomingFiltered,
    asOf: incomingAsOf,
    mode: incomingMode,
    at: Number.isFinite(Date.parse(incomingAsOf))
      ? Date.parse(incomingAsOf)
      : Date.now(),
  }));
  const [scope, setScope] = useState("all"),
    [masked, setMasked] = useState(initialMasked),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [printing, setPrinting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const chartId = useId();
  const holdings = useMemo(
    () =>
      scope === "filtered" ? filtered : portfolios.flatMap((p) => p.positions),
    [scope, filtered, portfolios],
  );
  const cash = portfolios.reduce((s, p) => s + p.cashBalance, 0);
  const assets = useMemo(() => holdings.map(assetFromHolding), [holdings]);
  const portfolioNames = new Map(portfolios.map((p) => [p.id, p.name]));
  const current = cash + assets.reduce((s, a) => s + a.currentValue, 0);
  const curves = useMemo(
    () =>
      Array.from({ length: 41 }, (_, index) => ({
        progress: index / 40,
        model: totalAt(
          assets,
          cash,
          index / 40,
          "model",
          defaultAssumptions,
          at,
        ),
        intrinsic: totalAt(
          assets,
          cash,
          index / 40,
          "intrinsic",
          defaultAssumptions,
          at,
        ),
      })),
    [assets, cash, at],
  );
  const projected = curves[40].model;
  const intrinsic = curves[40].intrinsic;
  const values = curves.flatMap((p) => [p.model, p.intrinsic]);
  const minimum = Math.min(...values),
    maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.14, maximum * 0.025, 1);
  const low = Math.max(0, minimum - padding),
    high = maximum + padding;
  const y = (value: number) => 180 - ((value - low) / (high - low)) * 180;
  const path = (kind: "model" | "intrinsic") =>
    curves
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${(p.progress * 580).toFixed(2)},${y(p[kind]).toFixed(2)}`,
      )
      .join(" ");
  const display = (v: number) => (masked ? "••••••" : money(v));
  const axisDisplay = (v: number) =>
    masked
      ? "••••••"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(v);
  const stamp = new Date(at).toISOString().slice(0, 10);
  const modelValues = assets.map((a) =>
    valueAt(a, 1, "model", defaultAssumptions, at),
  );

  function exportFile(kind: "csv" | "json") {
    setError("");
    setNotice("");
    try {
      if (kind === "csv") {
        const rows = [
          [
            "Portfolio",
            "Instrument",
            "Asset class",
            "Quantity",
            "Average cost",
            "Current value",
            "Target price",
            "Projected model value",
            "Intrinsic scenario value",
            "Quote source",
            "Quote timestamp",
            "Price estimated",
            "Valuation basis",
            "Quote stale",
            "Report as of",
          ],
          ...holdings.map((h, i) => [
            portfolioNames.get(h.portfolioId),
            h.optionDetails?.optionSymbol || h.symbol,
            h.assetClass,
            h.quantity,
            h.avgCost,
            h.projection.currentMarketValue,
            h.projection.targetUnderlyingPrice,
            modelValues[i],
            valueAt(assets[i], 1, "intrinsic", defaultAssumptions, at),
            h.projection.quoteSource,
            h.projection.quoteAsOf,
            h.projection.priceEstimated,
            h.projection.valuationBasis ??
              (h.projection.priceEstimated ? "COST_BASIS" : "MARK"),
            h.projection.quoteStale,
            asOf,
          ]),
        ];
        downloadText(
          "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
          `investor-desk-${stamp}-${scope}-holdings.csv`,
          "text/csv;charset=utf-8",
        );
      } else {
        downloadText(
          JSON.stringify(
            {
              version: 1,
              asOf,
              mode,
              scope,
              currency: "USD",
              portfolioNames: portfolios.map((p) => p.name),
              portfolios: portfolios.map((p) => ({
                id: p.id,
                name: p.name,
                cash: p.cashBalance,
              })),
              cash,
              assets,
              assumptions: defaultAssumptions,
              summary: {
                current,
                modelTarget: projected,
                intrinsicTarget: intrinsic,
              },
              quotes: holdings.map((h) => ({
                holdingId: h.id,
                source: h.projection.quoteSource,
                asOf: h.projection.quoteAsOf,
                estimated: h.projection.priceEstimated,
                valuationBasis:
                  h.projection.valuationBasis ??
                  (h.projection.priceEstimated ? "COST_BASIS" : "MARK"),
                stale: h.projection.quoteStale,
                impliedVolatilityEstimated: h.projection.ivEstimated,
                expirationPolicy: h.projection.expirationPolicy,
                expirationAssumed: h.projection.expirationAssumed,
              })),
              explanation:
                "Hypothetical simultaneous targets, not historical returns or a probability forecast. Untargeted holdings retain current value. Includes all selected portfolio cash even when holdings are filtered.",
            },
            null,
            2,
          ),
          `investor-desk-${stamp}-${scope}-snapshot.json`,
          "application/json",
        );
      }
      setNotice(
        `${kind.toUpperCase()} download requested. Check your browser’s downloads.`,
      );
    } catch {
      setError("The file could not be prepared. Please try again.");
    }
  }

  async function print() {
    setError("");
    setNotice("");
    if (!ref.current) return;
    const w = window.open("", "_blank");
    if (!w) {
      setError(
        "Your browser blocked the printable brief. Allow pop-ups for this site, then try again.",
      );
      return;
    }
    setPrinting(true);
    let fontWaitTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      w.opener = null;
      const html = ref.current.innerHTML;
      w.document.write(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Investor Desk · Investment brief · ${stamp}</title><base href="${window.location.origin}/"><style>${printStyles}${printFontStyles()}</style></head><body><div data-print-controls><button type="button">Print / save PDF</button>Choose “Save as PDF” in your browser’s print destination to keep a copy.</div>${html}</body></html>`,
      );
      w.document.close();
      w.document
        .querySelector("button")
        ?.addEventListener("click", () => w.print());
      await Promise.race([
        w.document.fonts.ready,
        new Promise((resolve) => {
          fontWaitTimer = setTimeout(resolve, 3000);
        }),
      ]);
      if (!w.closed) {
        w.focus();
        w.print();
        setNotice(
          "The printable brief is open in a new tab. You can print it or save it as a PDF there.",
        );
      }
    } catch {
      setError(
        "The print dialog could not open. If the brief opened in a new tab, use its Print / save PDF button.",
      );
    } finally {
      if (fontWaitTimer) clearTimeout(fontWaitTimer);
      setPrinting(false);
    }
  }

  return (
    <DeskModal
      title="Your investment brief"
      kicker="A perspective worth keeping"
      wide
      close={close}
    >
      <div className={`modal-body report-modal ${styles.modal}`}>
        <div className="report-tools">
          <label>
            Report scope
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">All holdings in selected portfolios</option>
              <option value="filtered">Current filtered holdings</option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={masked}
              onChange={(e) => setMasked(e.target.checked)}
            />
            Mask monetary values in presentation
          </label>
        </div>
        <div className={`report-sheet ${styles.sheet}`} ref={ref}>
          <span className="eyebrow">INVESTOR DESK / INVESTMENT BRIEF</span>
          <h1>The bigger picture.</h1>
          <p>{portfolios.map((p) => p.name).join(" · ") || "Your workspace"}</p>
          <p className="report-meta">
            Captured {new Date(at).toLocaleString()} · USD ·{" "}
            {mode === "demo"
              ? "Illustrative sample prices"
              : "Provider quotes; sources and timestamps below"}
            <br />
            {scope === "filtered"
              ? "Filtered holdings"
              : "All selected holdings"}{" "}
            · {holdings.length} positions · Cash from all selected portfolios
          </p>
          <div className="report-kpis">
            <div>
              <span>Current value</span>
              <strong>{display(current)}</strong>
            </div>
            <div>
              <span>At model targets</span>
              <strong>{display(projected)}</strong>
            </div>
            <div>
              <span>At intrinsic targets</span>
              <strong>{display(intrinsic)}</strong>
            </div>
          </div>
          <section>
            <h2>A view of the possibilities</h2>
            <figure className={styles.chart}>
              <div className={styles.graph}>
                <div className={styles.axis} aria-hidden="true">
                  {[1, 0.75, 0.5, 0.25, 0].map((f) => (
                    <span key={f}>{axisDisplay(low + (high - low) * f)}</span>
                  ))}
                </div>
                <div className={styles.plot}>
                  <svg
                    viewBox="0 0 580 180"
                    preserveAspectRatio="none"
                    role="img"
                    aria-labelledby={`${chartId}-title ${chartId}-description`}
                  >
                    <title id={`${chartId}-title`}>
                      Hypothetical portfolio value from current prices to
                      simultaneous targets
                    </title>
                    <desc id={`${chartId}-description`}>
                      Current value {display(current)}. Model target{" "}
                      {display(projected)}. Intrinsic target{" "}
                      {display(intrinsic)}. The horizontal axis is progress
                      toward targets, not elapsed time. Monetary values{" "}
                      {masked ? "are masked" : "are in US dollars"}.
                    </desc>
                    {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                      <line
                        key={f}
                        x1="0"
                        x2="580"
                        y1={f * 180}
                        y2={f * 180}
                        stroke="var(--line, #cfdbd1)"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    <line
                      x1="0"
                      x2="580"
                      y1={y(current)}
                      y2={y(current)}
                      stroke="var(--muted, #7b8c81)"
                      strokeWidth="1.5"
                      strokeDasharray="2 5"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={path("intrinsic")}
                      fill="none"
                      stroke="var(--copper, #af6744)"
                      strokeWidth="2"
                      strokeDasharray="7 5"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={path("model")}
                      fill="none"
                      stroke="var(--green, #28725a)"
                      strokeWidth="2.5"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={`M0,${y(current) - 3}v6 M580,${y(projected) - 3}v6`}
                      stroke="var(--green, #28725a)"
                      strokeWidth="5"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                </div>
                <div className={styles.labels}>
                  <span>Current prices</span>
                  <span>50%</span>
                  <span>At targets</span>
                </div>
              </div>
              <div className={styles.legend}>
                <span>
                  <i
                    className={styles.swatch}
                    style={{ borderColor: "var(--green, #28725a)" }}
                  />
                  Model scenario
                </span>
                <span>
                  <i
                    className={styles.swatch}
                    style={{
                      borderColor: "var(--copper, #af6744)",
                      borderTopStyle: "dashed",
                    }}
                  />
                  Intrinsic scenario
                </span>
                <span>
                  <i
                    className={styles.swatch}
                    style={{
                      borderColor: "var(--muted, #7b8c81)",
                      borderTopStyle: "dotted",
                    }}
                  />
                  Current value
                </span>
              </div>
              <figcaption className={styles.caption}>
                {assets.filter((a) => a.target != null).length} of{" "}
                {assets.length} holdings have targets. This comparison moves all
                targeted underlying prices together. Intrinsic uses a linear
                path to target intrinsic value; model includes remaining option
                time value. It shows possibilities, not historical returns or
                likelihood.
              </figcaption>
            </figure>
          </section>
          <section>
            <h2>Capital allocation</h2>
            <div className="report-allocation">
              {[
                [
                  "Equities & ETFs",
                  holdings
                    .filter((h) => !h.optionDetails)
                    .reduce((s, h) => s + h.projection.currentMarketValue, 0),
                ],
                [
                  "Options",
                  holdings
                    .filter((h) => h.optionDetails)
                    .reduce((s, h) => s + h.projection.currentMarketValue, 0),
                ],
                ["Virtual cash", cash],
              ].map(([label, v]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>
                    {display(Number(v))} ·{" "}
                    {current ? ((Number(v) / current) * 100).toFixed(1) : 0}%
                  </strong>
                </div>
              ))}
            </div>
          </section>
          <section>
            <h2>Holdings & conviction</h2>
            {holdings.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Holding</th>
                      <th>Quantity</th>
                      <th>Current value</th>
                      <th>Underlying target</th>
                      <th>At model target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map((h, i) => (
                      <tr key={h.id}>
                        <td>
                          {h.optionDetails
                            ? `${h.optionDetails.underlying} ${display(Number(h.optionDetails.strike))} ${h.optionDetails.right} ${h.optionDetails.expiration.slice(0, 10)}`
                            : h.symbol}
                          <small>
                            {portfolioNames.get(h.portfolioId)} ·{" "}
                            {h.projection.quoteSource}
                            {h.projection.priceEstimated
                              ? " · cost-basis estimate"
                              : h.projection.valuationBasis ===
                                  "OPTION_MIDPOINT"
                                ? " · midpoint estimate"
                                : ""}
                            {h.projection.quoteStale ? " · stale" : ""}
                            {h.projection.expirationAssumed
                              ? " · assumed expiry time"
                              : ""}
                            {h.optionDetails && h.projection.ivEstimated
                              ? " · estimated IV"
                              : ""}
                            <br />
                            {h.projection.quoteAsOf
                              ? new Date(
                                  h.projection.quoteAsOf,
                                ).toLocaleString()
                              : "Timestamp unavailable"}
                          </small>
                        </td>
                        <td>{num(h.quantity)}</td>
                        <td>{display(h.projection.currentMarketValue)}</td>
                        <td>
                          {h.projection.hasTarget
                            ? display(h.projection.targetUnderlyingPrice ?? 0)
                            : "Not set"}
                        </td>
                        <td>{display(modelValues[i])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="fine-print">
                No holdings are included in this scope. Selected portfolio cash
                remains included in the brief.
              </p>
            )}
          </section>
          <footer className="report-footer">
            <h2>What these numbers mean</h2>
            <p className="fine-print">
              Every target is assumed to happen together. These scenarios are
              not a timeline or probability forecast. Untargeted holdings retain
              current value. Options use standard deliverables, time remaining
              as of this capture, available IV (60% when unavailable), 4%
              interest, and zero dividends. Expired scenarios use target
              intrinsic value. No fees, dividends, early exercise, or slippage
              are modeled. This is a simulation; no orders are sent to a broker.
            </p>
            {masked && (
              <p className="fine-print">
                Monetary values are masked for presentation. Portfolio names,
                instruments, quantities, allocation percentages, and the
                relative shape of scenarios remain visible.
              </p>
            )}
          </footer>
        </div>
        <div className="report-export-actions">
          <button
            className="button secondary"
            onClick={() => exportFile("csv")}
          >
            <Download size={16} />
            Holdings CSV
          </button>
          <button
            className="button secondary"
            onClick={() => exportFile("json")}
          >
            <FileJson size={16} />
            Snapshot JSON
          </button>
          <button
            className="button primary"
            onClick={print}
            disabled={printing}
          >
            <Printer size={16} />
            {printing ? "Preparing brief…" : "Print / save PDF"}
          </button>
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="fine-print" role="status">
            {notice}
          </p>
        )}
        <p className="fine-print">
          CSV and JSON include exact values. Presentation masking applies to the
          brief and its PDF only. The brief is a fixed capture; reopen it to
          include newer prices or edits.
        </p>
      </div>
    </DeskModal>
  );
}
