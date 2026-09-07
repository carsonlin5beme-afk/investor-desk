"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  LayoutDashboard,
  Wallet,
  Target,
  Activity,
  Download,
  RefreshCw,
  Settings2,
  BarChart3,
  Layers,
  ChevronRight,
  AlertCircle,
  Check,
  Building2,
} from "lucide-react";
import {
  api,
  DeskData,
  Portfolio,
  Holding,
  money,
  compact,
  num,
} from "@/lib/desk-types";
import { blackScholesPrice } from "@/server/domain/black-scholes";
import { MarketDataCheck } from "./MarketDataCheck";
import { DeskModal } from "./DeskModal";
import { TargetEditor } from "./TargetEditor";
import { OrderTicket } from "./OrderTicket";
function scenarioValue(h: Holding, progress: number) {
  const p = h.projection;
  if (!p.hasTarget || p.targetUnderlyingPrice == null)
    return p.currentMarketValue;
  if (h.assetClass === "EQUITY")
    return (
      p.currentMarketValue +
      (p.projectedValue - p.currentMarketValue) * progress
    );
  const o = h.optionDetails;
  if (!o || p.underlyingPrice == null)
    return (
      p.currentMarketValue +
      (p.projectedValue - p.currentMarketValue) * progress
    );
  const spot =
    p.underlyingPrice +
    (p.targetUnderlyingPrice - p.underlyingPrice) * progress;
  const model =
    blackScholesPrice({
      spot,
      strike: Number(o.strike),
      timeToExpiryYears: Math.max(
        0,
        (new Date(o.expiration).getTime() - Date.now()) / (365 * 86400000),
      ),
      riskFreeRate: 0.04,
      volatility: p.impliedVolatility ?? 0.6,
      isCall: o.right === "CALL",
    }) *
    h.quantity *
    o.multiplier;
  const base =
    blackScholesPrice({
      spot: p.underlyingPrice,
      strike: Number(o.strike),
      timeToExpiryYears: Math.max(
        0,
        (new Date(o.expiration).getTime() - Date.now()) / (365 * 86400000),
      ),
      riskFreeRate: 0.04,
      volatility: p.impliedVolatility ?? 0.6,
      isCall: o.right === "CALL",
    }) *
    h.quantity *
    o.multiplier;
  return Math.max(0, model + (p.currentMarketValue - base) * (1 - progress));
}
function Trajectory({
  positions,
  cash,
  current,
  projected,
}: {
  positions: Holding[];
  cash: number;
  current: number;
  projected: number;
}) {
  const [progress, setProgress] = useState(100);
  const values = useMemo(
    () =>
      Array.from(
        { length: 41 },
        (_, i) =>
          cash + positions.reduce((s, h) => s + scenarioValue(h, i / 40), 0),
      ),
    [positions, cash],
  );
  const min = Math.min(...values, current) * 0.85,
    max = Math.max(...values, projected) * 1.05 || 1,
    span = max - min || 1;
  const x = (i: number) => 30 + (i / 40) * 710,
    y = (v: number) => 185 - ((v - min) / span) * 155;
  const line = values
    .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const value =
    cash + positions.reduce((s, h) => s + scenarioValue(h, progress / 100), 0);
  return (
    <section className="panel trajectory">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Your investment thesis, visualized</span>
          <h2>From today to your targets</h2>
        </div>
        <span className="badge subtle">Scenario explorer</span>
      </div>
      <div className="chart-summary">
        <strong>{money(value, 0)}</strong>
        <span>at {progress}% of the move toward each target</span>
      </div>
      <svg
        className="trajectory-chart"
        viewBox="0 0 780 220"
        role="img"
        aria-label="Hypothetical portfolio value as each holding moves toward its target, not a time forecast"
      >
        <defs>
          <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#177968" stopOpacity=".20" />
            <stop offset="100%" stopColor="#177968" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((i) => (
          <line
            key={i}
            x1="30"
            x2="740"
            y1={30 + i * 52}
            y2={30 + i * 52}
            stroke="#dce3dd"
            strokeDasharray="3 5"
          />
        ))}
        <path d={`${line} L740,195 L30,195 Z`} fill="url(#chart-fill)" />
        <path d={line} fill="none" stroke="#177968" strokeWidth="3" />
        <line
          x1={30 + (progress / 100) * 710}
          x2={30 + (progress / 100) * 710}
          y1="25"
          y2="195"
          stroke="#ba7956"
          strokeDasharray="4 4"
        />
        <circle
          cx={30 + (progress / 100) * 710}
          cy={y(value)}
          r="6"
          fill="#177968"
          stroke="white"
          strokeWidth="3"
        />
        <text x="30" y="216">
          Today
        </text>
        <text x="740" y="216" textAnchor="end">
          All targets hit
        </text>
      </svg>
      <label className="range-label">
        <span>Explore the scenario</span>
        <input
          aria-label="Target progress"
          type="range"
          min="0"
          max="100"
          value={progress}
          onChange={(e) => setProgress(Number(e.target.value))}
        />
        <b>{progress}%</b>
      </label>
      <p className="fine-print">
        Not a time forecast. Each underlying moves toward its own target;
        options use fixed time-to-expiry and IV. The curve blends today&apos;s
        mark into the option model. Holdings without targets stay at current
        value.
      </p>
    </section>
  );
}
export function InvestorDesk({ portfolioId }: { portfolioId?: string }) {
  const [data, setData] = useState<DeskData | null>(null),
    [error, setError] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [tab, setTab] = useState("Holdings"),
    [filter, setFilter] = useState("ALL"),
    [search, setSearch] = useState("");
  const [modal, setModal] = useState<"create" | "cash" | "settings" | null>(
      null,
    ),
    [target, setTarget] = useState<Holding | null>(null),
    [ticket, setTicket] = useState<{
      portfolio: Portfolio;
      holding?: Holding;
    } | null>(null),
    [toast, setToast] = useState("");
  const inFlight = useRef(false),
    mounted = useRef(true);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const d = await api<DeskData>("/api/desk");
      if (mounted.current) {
        setData(d);
        setError("");
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      inFlight.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    const show = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", show);
    return () => {
      mounted.current = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", show);
    };
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const all = data?.portfolios ?? [],
    active = all.find((p) => p.id === portfolioId),
    selected = portfolioId ? all.filter((p) => p.id === portfolioId) : all;
  const holdings = selected.flatMap((p) => p.positions),
    current = selected.reduce((s, p) => s + p.currentValue, 0),
    cash = selected.reduce((s, p) => s + p.cashBalance, 0),
    projected = selected.reduce((s, p) => s + p.projectedNetWorth, 0),
    equities = selected.reduce((s, p) => s + p.equitiesValue, 0),
    options = selected.reduce((s, p) => s + p.optionsValue, 0),
    intrinsic = selected.reduce((s, p) => s + p.intrinsicNetWorth, 0),
    targetCount = holdings.filter((h) => h.projection.hasTarget).length;
  const filtered = holdings.filter(
    (h) =>
      (filter === "ALL" || h.assetClass === filter) &&
      `${h.symbol} ${h.optionDetails?.underlying ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const saved = () => {
    void load();
    setToast("Portfolio updated");
  };
  const trade = () => {
    const p = active ?? all[0];
    if (p) setTicket({ portfolio: p });
    else setModal("create");
  };
  function exportCsv() {
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
        "Intrinsic value",
        "Quote source",
      ],
      ...holdings.map((h) => [
        all.find((p) => p.id === h.portfolioId)?.name ?? "",
        h.symbol,
        h.assetClass,
        h.quantity,
        h.avgCost,
        h.projection.currentMarketValue,
        h.projection.targetUnderlyingPrice ?? "",
        h.projection.projectedValue,
        h.projection.optionIntrinsicProjectedValue ?? "",
        h.projection.quoteSource,
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map(
            (v) =>
              `"${String(typeof v === "string" && /^[=+@-]/.test(v) ? "'" + v : v).replaceAll('"', '""')}"`,
          )
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "investor-desk-holdings.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="desk-shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <BarChart3 size={22} />
          </span>
          <span>
            investor<span className="brand-light">desk</span>
            <small>THE BIGGER PICTURE</small>
          </span>
        </Link>
        <div className="workspace-label">Your workspace</div>
        <Link href="/" className={`nav-item ${!portfolioId ? "active" : ""}`}>
          <LayoutDashboard size={18} />
          Overview
        </Link>
        <div className="nav-section-label">
          <span>PORTFOLIOS</span>
          <button
            aria-label="Create portfolio"
            onClick={() => setModal("create")}
          >
            <Plus size={16} />
          </button>
        </div>
        <nav className="portfolio-nav">
          {all.map((p, i) => (
            <Link
              key={p.id}
              href={`/portfolios/${p.id}`}
              className={`nav-item ${active?.id === p.id ? "active" : ""}`}
            >
              <span
                className="portfolio-dot"
                style={{ background: ["#89cdb8", "#cdab7c", "#96adca"][i % 3] }}
              />
              {p.name}
              <ChevronRight size={14} />
            </Link>
          ))}
          {!all.length && (
            <span className="nav-empty">
              Create your first portfolio
              <br />
              and start building your thesis.
            </span>
          )}
        </nav>
        <button
          className="nav-item settings-link"
          onClick={() => setModal("settings")}
        >
          <Settings2 size={18} />
          Data & assumptions
        </button>
        <div className="sidebar-note">
          <div className="orbital" />
          <span>
            A view beyond
            <br />
            the current price.
          </span>
          <p>
            Build a portfolio.
            <br />
            Put your convictions in perspective.
          </p>
        </div>
        <div className="local-label">
          <span />
          Local workspace<small>Single user · USD · Simulation</small>
        </div>
      </aside>
      <main className="main-desk">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{active?.name ?? "Overview"}</strong>
          </div>
          <div className="topbar-right">
            <span
              className={`status-pill ${data?.mode === "demo" ? "sample" : ""}`}
            >
              <span />
              {data?.mode === "demo"
                ? "Sample data"
                : data
                  ? "Live provider mode"
                  : "Connecting"}
            </span>
            <button
              className="icon-button"
              aria-label="Refresh portfolio"
              onClick={load}
              disabled={refreshing}
            >
              <RefreshCw size={16} className={refreshing ? "spin" : ""} />
            </button>
            <span className="avatar">CL</span>
          </div>
        </header>
        <div className="desk-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">YOUR CAPITAL. YOUR CONVICTION.</span>
              <h1>
                {active?.name ?? "Portfolio overview"}
                <span className="heading-dot">.</span>
              </h1>
              <p>Understand where you stand. Explore where you could go.</p>
            </div>
            <div className="heading-actions">
              <button
                className="button secondary"
                onClick={() => setModal(active ? "cash" : "create")}
              >
                <Plus size={17} />
                {active ? "Manage cash" : "New portfolio"}
              </button>
              <button className="button primary" onClick={trade}>
                <ArrowUpRight size={18} />
                New order
              </button>
            </div>
          </div>
          {error && (
            <div className="error-box" role="alert">
              <AlertCircle size={18} />
              {error}
              <button className="text-button" onClick={load}>
                Retry connection
              </button>
            </div>
          )}
          {portfolioId && data && !active && (
            <div className="error-box">
              Portfolio not found. <Link href="/">Return to overview</Link>
            </div>
          )}
          {data?.mode === "demo" && (
            <div className="data-notice">
              <span className="badge amber">SAMPLE MODE</span>
              <span>
                Explore the complete simulator with illustrative prices. No real
                money, no real orders.
              </span>
              <button onClick={() => setModal("settings")}>
                Connect market data
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {data?.mode === "live" &&
            (!data.feeds.equities || !data.feeds.options) && (
              <div className="error-box">
                Some market-data credentials are missing.{" "}
                <button
                  className="text-button"
                  onClick={() => setModal("settings")}
                >
                  View setup
                </button>
              </div>
            )}
          {data?.mode === "live" && data.feeds.equityFeed === "iex" && (
            <div className="data-notice">
              <span className="badge amber">IEX ONLY</span>
              <span>
                Stock quotes represent one exchange, not consolidated SIP
                coverage.
              </span>
            </div>
          )}
          <section className="net-worth-hero">
            <div className="hero-main">
              <span className="eyebrow">
                PROJECTED NET WORTH <Target size={14} />
              </span>
              <div className="hero-value">
                {data ? money(projected, 0) : "Loading..."}
              </div>
              <div className="hero-growth">
                <span
                  className={
                    projected >= current ? "positive-tag" : "negative-tag"
                  }
                >
                  <ArrowUpRight size={15} />
                  {current
                    ? `${((projected / current - 1) * 100).toFixed(1)}%`
                    : "0%"}
                </span>
                <span>
                  {money(projected - current, 0)} potential change from today
                </span>
              </div>
              <p>If every holding reaches its own target, simultaneously.</p>
            </div>
            <div className="hero-aside">
              <span className="hero-icon">
                <Target size={24} />
              </span>
              <strong>
                {targetCount}
                <span> / {holdings.length}</span>
              </strong>
              <span>holdings with a target</span>
              <div className="coverage-track">
                <i
                  style={{
                    width: `${holdings.length ? (targetCount / holdings.length) * 100 : 0}%`,
                  }}
                />
              </div>
              <small>Untargeted holdings retain current value.</small>
            </div>
          </section>
          <div className="metrics-grid">
            {[
              {
                label: "Total account value",
                value: current,
                icon: Wallet,
                detail: `${selected.length} ${selected.length === 1 ? "portfolio" : "portfolios"}`,
              },
              {
                label: "Available cash",
                value: cash,
                icon: Building2,
                detail: "Ready to invest",
              },
              {
                label: "Equities & ETFs",
                value: equities,
                icon: BarChart3,
                detail: `${holdings.filter((h) => h.assetClass === "EQUITY").length} positions`,
              },
              {
                label: "Options value",
                value: options,
                icon: Layers,
                detail: `${holdings.filter((h) => h.assetClass === "OPTION").length} positions`,
              },
            ].map((m) => (
              <section className="metric-card" key={m.label}>
                <div>
                  <span>{m.label}</span>
                  <m.icon size={17} />
                </div>
                <strong>{money(m.value, 0)}</strong>
                <small>{m.detail}</small>
              </section>
            ))}
          </div>
          {!active && all.length > 0 && (
            <section className="portfolio-strip">
              {all.map((p) => (
                <Link key={p.id} href={`/portfolios/${p.id}`}>
                  <span className="portfolio-card-icon">
                    <Wallet size={19} />
                  </span>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.positions.length} positions · {money(p.cashBalance, 0)}{" "}
                      cash
                    </small>
                  </div>
                  <div className="portfolio-card-total">
                    <strong>{money(p.currentValue, 0)}</strong>
                    <small>{compact(p.projectedNetWorth)} at targets</small>
                  </div>
                  <ChevronRight size={16} />
                </Link>
              ))}
            </section>
          )}
          <div className="analysis-grid">
            <Trajectory
              positions={holdings}
              cash={cash}
              current={current}
              projected={projected}
            />
            <section className="panel allocation-panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">The composition</span>
                  <h2>Capital allocation</h2>
                </div>
              </div>
              <div
                className="allocation-ring"
                style={{
                  background: `conic-gradient(#177968 0 ${current ? (equities / current) * 100 : 0}%, #bc805f ${current ? (equities / current) * 100 : 0}% ${current ? ((equities + options) / current) * 100 : 0}%, #dfe6df 0 100%)`,
                }}
              >
                <div>
                  <small>INVESTED</small>
                  <strong>
                    {current
                      ? Math.round(((equities + options) / current) * 100)
                      : 0}
                    %
                  </strong>
                </div>
              </div>
              <div className="allocation-legend">
                {[
                  ["Equities / ETFs", equities, "#177968"],
                  ["Options", options, "#bc805f"],
                  ["Cash", cash, "#dfe6df"],
                ].map(([label, v, color]) => (
                  <div key={label}>
                    <i style={{ background: String(color) }} />
                    <span>{label}</span>
                    <strong>{money(Number(v), 0)}</strong>
                  </div>
                ))}
              </div>
              <div className="intrinsic-total">
                <span>Net worth at intrinsic targets</span>
                <strong>{money(intrinsic, 0)}</strong>
                <small>Equities at targets + option intrinsic + cash.</small>
              </div>
            </section>
          </div>
          <section className="panel holdings-panel">
            <div className="holdings-toolbar">
              <div className="tabs">
                {["Holdings", "Activity"].map((t) => (
                  <button
                    key={t}
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                  >
                    {t}
                    {t === "Holdings" && <span>{holdings.length}</span>}
                  </button>
                ))}
              </div>
              <button
                className="text-button"
                onClick={exportCsv}
                disabled={!holdings.length}
              >
                <Download size={15} />
                Export holdings
              </button>
            </div>
            {tab === "Holdings" ? (
              <>
                <div className="table-filters">
                  <div className="filter-pills">
                    {[
                      ["ALL", "All assets"],
                      ["EQUITY", "Stocks / ETFs"],
                      ["OPTION", "Options"],
                    ].map(([k, label]) => (
                      <button
                        key={k}
                        className={filter === k ? "active" : ""}
                        onClick={() => setFilter(k)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <input
                    aria-label="Filter holdings"
                    placeholder="Filter by symbol..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                {!filtered.length ? (
                  <div className="empty-state">
                    <span>
                      <Layers size={28} />
                    </span>
                    <h3>
                      {holdings.length
                        ? "No matching holdings"
                        : "Your next idea starts here."}
                    </h3>
                    <p>
                      {holdings.length
                        ? "Try a different symbol or asset filter."
                        : "Add simulated stocks, ETFs, or options. Then set targets to see the bigger picture."}
                    </p>
                    {!holdings.length && (
                      <button className="button primary" onClick={trade}>
                        {all.length
                          ? "Place your first order"
                          : "Create your first portfolio"}
                        <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table className="holdings-table">
                      <thead>
                        <tr>
                          <th>Holding</th>
                          <th>Quantity / cost</th>
                          <th>Current value</th>
                          <th>Unrealized P/L</th>
                          <th>Underlying target</th>
                          <th>At target</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((h) => {
                          const p = h.projection;
                          return (
                            <tr key={h.id}>
                              <td>
                                <div className="holding-name">
                                  <span
                                    className={`symbol-avatar ${h.assetClass === "OPTION" ? "option-avatar" : ""}`}
                                  >
                                    {(
                                      h.optionDetails?.underlying ?? h.symbol
                                    ).slice(0, 2)}
                                  </span>
                                  <div>
                                    <strong>
                                      {h.optionDetails?.underlying ?? h.symbol}
                                      <span className="asset-label">
                                        {h.assetClass === "OPTION"
                                          ? h.optionDetails?.right
                                          : "STOCK / ETF"}
                                      </span>
                                    </strong>
                                    <small>
                                      {h.optionDetails
                                        ? `${money(Number(h.optionDetails.strike))} strike · ${h.optionDetails.expiration.slice(0, 10)}`
                                        : all.find(
                                            (p) => p.id === h.portfolioId,
                                          )?.name}
                                    </small>
                                    <small
                                      className={
                                        p.quoteStale || p.priceEstimated
                                          ? "warning-text"
                                          : ""
                                      }
                                      title={
                                        p.quoteAsOf ?? "No price available"
                                      }
                                    >
                                      {p.priceEstimated
                                        ? "Cost-basis estimate"
                                        : p.quoteSource === "demo"
                                          ? "Sample quote"
                                          : `${p.quoteStale ? "Stale / market closed · " : ""}${p.quoteAsOf ? new Date(p.quoteAsOf).toLocaleString() : "Unavailable"}`}
                                      {p.expired
                                        ? " · Expired; not settled"
                                        : ""}
                                    </small>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <strong>
                                  {num(h.quantity)}{" "}
                                  {h.assetClass === "OPTION" ? "ct" : "sh"}
                                </strong>
                                <small>{money(h.avgCost)} avg</small>
                              </td>
                              <td>
                                <strong>{money(p.currentMarketValue)}</strong>
                                <small>
                                  {money(p.currentPrice)}{" "}
                                  {h.assetClass === "OPTION"
                                    ? "premium"
                                    : "per share"}
                                </small>
                              </td>
                              <td>
                                <strong
                                  className={
                                    p.unrealizedPnL >= 0
                                      ? "positive"
                                      : "negative"
                                  }
                                >
                                  {p.unrealizedPnL >= 0 ? "+" : ""}
                                  {money(p.unrealizedPnL)}
                                </strong>
                                <small>
                                  {p.costBasis
                                    ? (
                                        (p.unrealizedPnL / p.costBasis) *
                                        100
                                      ).toFixed(2)
                                    : "0"}
                                  %
                                </small>
                              </td>
                              <td>
                                <button
                                  className={`target-button ${p.hasTarget ? "has-target" : ""}`}
                                  onClick={() => setTarget(h)}
                                >
                                  <Target size={14} />
                                  {p.hasTarget
                                    ? money(p.targetUnderlyingPrice)
                                    : "Set target"}
                                </button>
                                {h.targetScenario?.targetMode ===
                                  "MARKET_CAP" && (
                                  <small>
                                    {compact(
                                      Number(h.targetScenario.targetMarketCap),
                                    )}{" "}
                                    market cap
                                  </small>
                                )}
                              </td>
                              <td>
                                <strong className="projected-cell">
                                  {money(p.projectedValue)}
                                </strong>
                                <small>
                                  {p.hasTarget
                                    ? h.assetClass === "OPTION"
                                      ? `${money(p.optionIntrinsicProjectedValue)} intrinsic${p.ivEstimated ? " · assumed IV" : ""}`
                                      : "At your target"
                                    : "No target / current value"}
                                </small>
                              </td>
                              <td>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    setTicket({
                                      portfolio: all.find(
                                        (p) => p.id === h.portfolioId,
                                      )!,
                                      holding: h,
                                    })
                                  }
                                >
                                  Sell
                                  <ArrowUpRight size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={2}>Holdings total</td>
                          <td>{money(equities + options)}</td>
                          <td colSpan={2}>Cash included in net worth above</td>
                          <td>{money(projected - cash)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <ActivityTable portfolios={selected} />
            )}
            {holdings.some((h) => h.projection.priceEstimated) && (
              <div className="table-footnote warning-text">
                Some quotes are unavailable. Cost basis is used as an explicitly
                estimated current value, not a live price.
              </div>
            )}
            <div className="table-footnote">
              Values refresh every 15 seconds while this tab is visible.{" "}
              {data?.asOf
                ? `Last refreshed ${new Date(data.asOf).toLocaleTimeString()}.`
                : ""}
            </div>
          </section>
          <footer className="desk-footer">
            <span>
              INVESTOR DESK <i>/</i> A clearer view of what could be.
            </span>
            <span>Hypothetical scenarios, not investment advice.</span>
          </footer>
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      {modal === "create" && (
        <CashModal close={() => setModal(null)} saved={saved} />
      )}{" "}
      {modal === "cash" && active && (
        <CashModal
          portfolio={active}
          close={() => setModal(null)}
          saved={saved}
        />
      )}{" "}
      {modal === "settings" && (
        <DeskModal
          title="Data & assumptions"
          kicker="Know what powers your numbers"
          close={() => setModal(null)}
        >
          <div className="modal-body settings-body">
            <div className="info-box">
              Current mode:{" "}
              <strong>
                {data?.mode === "demo"
                  ? "Sample data, not live prices"
                  : "Live provider adapters"}
              </strong>
              . All orders are simulated in either mode.
            </div>
            <h3>Connect live market data</h3>
            <p>
              Edit your local <code>.env</code> and restart the app. Keys stay
              server-side and are excluded from GitHub.
            </p>
            <pre>
              MARKET_DATA_MODE=live
              <br />
              ALPACA_API_KEY=...
              <br />
              ALPACA_API_SECRET=...
              <br />
              ALPACA_FEED=sip
              <br />
              OPTIONS_PROVIDER=alpaca
              <br />
              ALPHAVANTAGE_API_KEY=...
            </pre>
            <p>
              Alpaca IEX covers one exchange, not the consolidated tape. SIP and
              real-time options require provider entitlements. Tradier sandbox
              quotes are delayed. Stale or delayed quotes remain visible but
              cannot execute orders.
            </p>
            <p>
              For the original hybrid setup use OPTIONS_PROVIDER=tradier and add
              TRADIER_API_TOKEN. Alpaca reference endpoints default to
              paper-api.alpaca.markets; live-account keys need
              ALPACA_REFERENCE_BASE_URL=https://api.alpaca.markets. Only
              read-only reference endpoints are used.
            </p>
            <MarketDataCheck />
            <h3>Projection assumptions</h3>
            <ul>
              <li>
                Every target is hit simultaneously, not at a predicted future
                date.
              </li>
              <li>
                Market-cap targets divide valuation by shares outstanding.
                Manual overrides take priority.
              </li>
              <li>
                Options use a standard 100-share multiplier. Black-Scholes
                assumes 4% risk-free interest and no dividends; it does not
                model early exercise.
              </li>
              <li>
                Provider IV is used when available; otherwise 60% is clearly
                labeled as an assumption. Expired option projections use target
                intrinsic value, not actual settlement.
              </li>
              <li>
                Shorting, margin, adjusted contracts, automatic exercise,
                corporate actions, and resting orders are not supported.
              </li>
            </ul>
            <p className="fine-print">
              Sample mode supports TSLA, BTG, AAPL, NVDA, MSFT, AMZN, GOOGL,
              JPM, V, SPY, QQQ, and VOO. Sample figures and sample shares
              outstanding are invented fixtures, not current financial data.
            </p>
          </div>
        </DeskModal>
      )}
      {target && (
        <TargetEditor
          holding={target}
          mode={data?.mode ?? "demo"}
          close={() => setTarget(null)}
          saved={saved}
        />
      )}{" "}
      {ticket && (
        <OrderTicket
          portfolio={ticket.portfolio}
          holding={ticket.holding}
          mode={data?.mode ?? "demo"}
          close={() => setTicket(null)}
          saved={saved}
        />
      )}
    </div>
  );
}
function CashModal({
  portfolio,
  close,
  saved,
}: {
  portfolio?: Portfolio;
  close: () => void;
  saved: () => void;
}) {
  const [name, setName] = useState(""),
    [amount, setAmount] = useState(portfolio ? "" : "250000"),
    [type, setType] = useState("DEPOSIT"),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(
        portfolio ? `/api/portfolios/${portfolio.id}/cash` : "/api/portfolios",
        "POST",
        portfolio
          ? { type, amount: Number(amount), note }
          : { name, startingCash: Number(amount) },
      );
      saved();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DeskModal
      title={portfolio ? "Manage cash" : "Create a portfolio"}
      kicker={portfolio?.name ?? "A new space for your investments"}
      close={close}
      busy={busy}
    >
      <form className="modal-body" onSubmit={submit}>
        {portfolio ? (
          <>
            <div className="scenario-preview">
              <span>Available cash</span>
              <strong>{money(portfolio.cashBalance)}</strong>
            </div>
            <label>
              Cash action
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="DEPOSIT">Deposit simulated cash</option>
                <option value="WITHDRAWAL">Withdraw simulated cash</option>
              </select>
            </label>
          </>
        ) : (
          <label>
            Portfolio name
            <input
              autoFocus
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Personal"
            />
          </label>
        )}
        <label>
          {portfolio ? "Amount ($)" : "Starting cash ($)"}
          <input
            required
            type="number"
            min={portfolio ? 0.01 : 0}
            max="1000000000000"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {portfolio && (
          <label>
            Note (optional)
            <input
              maxLength={240}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Monthly allocation"
            />
          </label>
        )}
        <p className="muted">
          Each portfolio has its own cash balance. This is simulated funding,
          not a real transfer.
        </p>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <footer className="modal-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy
              ? "Saving..."
              : portfolio
                ? "Confirm cash adjustment"
                : "Create portfolio"}
            <ArrowRight size={16} />
          </button>
        </footer>
      </form>
    </DeskModal>
  );
}
function ActivityTable({ portfolios }: { portfolios: Portfolio[] }) {
  const events = portfolios
    .flatMap((p) => p.ledger.map((l) => ({ ...l, portfolio: p.name })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const realized = portfolios.reduce(
    (s, p) =>
      s +
      p.orders.reduce(
        (s, o) => s + o.fills.reduce((s, f) => s + Number(f.realizedPnL), 0),
        0,
      ),
    0,
  );
  return (
    <>
      <div className="activity-summary">
        <Activity size={18} />
        <span>Recent transactions</span>
        <span>
          Realized P/L from displayed orders:{" "}
          <b className={realized >= 0 ? "positive" : "negative"}>
            {money(realized)}
          </b>
        </span>
      </div>
      {!events.length ? (
        <div className="empty-state">
          <h3>No activity yet.</h3>
          <p>Your deposits and trades will appear here.</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Transaction</th>
                <th>Portfolio</th>
                <th>Details</th>
                <th>Date</th>
                <th>Cash impact</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>
                    <span className="badge subtle">{e.type}</span>
                  </td>
                  <td>{e.portfolio}</td>
                  <td>{e.note ?? "Cash adjustment"}</td>
                  <td>{new Date(e.createdAt).toLocaleString()}</td>
                  <td
                    className={Number(e.amount) >= 0 ? "positive" : "negative"}
                  >
                    {money(Number(e.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
