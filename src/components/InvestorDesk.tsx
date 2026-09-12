"use client";
import {
  AmbientRadioControls,
  DialogRadioControl,
} from "@/components/AmbientRadio";
import Link from "next/link";
import { BrandMonogram, BrandWordmark } from "@/components/Brand";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  LayoutDashboard,
  Wallet,
  Target,
  Download,
  Settings2,
  BarChart3,
  Layers,
  ChevronRight,
  Check,
  Search,
  BookOpen,
  GitCompareArrows,
  SlidersHorizontal,
  Menu,
  X,
  MoreHorizontal,
  Pin,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import {
  api,
  type DeskData,
  type Portfolio,
  type Holding,
  money,
  num,
} from "@/lib/desk-types";
import { assetFromHolding, totalAt } from "@/lib/studio";
import { authClient } from "@/lib/auth-client";
import { DeskModal } from "./DeskModal";
import { TargetEditor } from "./TargetEditor";
import { OrderTicket } from "./OrderTicket";
import { useWorkspace } from "./studio/useWorkspace";
import { CashModal } from "./studio/CashModal";
import { Settings } from "./studio/Settings";
import { PortfolioManager } from "./studio/PortfolioManager";
import { Trajectory } from "./studio/Trajectory";
import { Allocation } from "./studio/Allocation";
import { Holdings } from "./studio/Holdings";
import { Activity } from "./studio/Activity";
import { ScenarioStudio } from "./studio/ScenarioStudio";
import { Journal } from "./studio/Journal";
import { Report } from "./studio/Report";
import { OptionsExplorer } from "./studio/OptionsExplorer";
import { CommandPalette, type CommandItem } from "./studio/CommandPalette";
import styles from "./dashboard-polish.module.css";
import { OrbitRefreshIcon, OrbitVisibilityIcon } from "./SpaceControlIcons";

type View = "overview" | "studio" | "journal";
export function InvestorDesk({ portfolioId }: { portfolioId?: string }) {
  const router = useRouter();
  const [data, setData] = useState<DeskData | null>(null),
    [error, setError] = useState(""),
    [refreshing, setRefreshing] = useState(false),
    [view, setView] = useState<View>("overview"),
    [tab, setTab] = useState("Holdings"),
    [filter, setFilter] = useState("ALL"),
    [search, setSearch] = useState(""),
    [quality, setQuality] = useState("ALL"),
    [method, setMethod] = useState<"model" | "intrinsic">("model");
  const [modal, setModal] = useState<
      "create" | "cash" | "settings" | "manager" | "portfolio-picker" | null
    >(null),
    [target, setTarget] = useState<Holding | null>(null),
    [ticket, setTicket] = useState<{
      portfolio: Portfolio;
      holding?: Holding;
    } | null>(null),
    [detail, setDetail] = useState<Holding | null>(null),
    [report, setReport] = useState(false),
    [command, setCommand] = useState(false),
    [mobileNav, setMobileNav] = useState(false),
    [toast, setToast] = useState(""),
    [expandedNotice, setExpandedNotice] = useState(false),
    [presentation, setPresentation] = useState(false),
    [showArchived, setShowArchived] = useState(false),
    [journalSymbol, setJournalSymbol] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const media = matchMedia("(max-width:760px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobileNav || !isMobile) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const nav = document.querySelector<HTMLElement>(".sidebar");
    const trigger = document.activeElement as HTMLElement | null;
    nav?.querySelector<HTMLElement>("a,button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setMobileNav(false);
      }
      if (e.key === "Tab") {
        const els = [
          ...nav!.querySelectorAll<HTMLElement>(
            "a[href],button:not(:disabled)",
          ),
        ].filter((el) => el.getBoundingClientRect().height > 0);
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = old;
      window.removeEventListener("keydown", key);
      trigger?.focus();
    };
  }, [mobileNav, isMobile]);
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
        setTicket((old) => {
          if (!old) return null;
          const p = d.portfolios.find((p) => p.id === old.portfolio.id);
          return p ? { ...old, portfolio: p } : null;
        });
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
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 15000);
    const show = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", show);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", show);
    };
  }, [load]);
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("view");
    if (q === "studio" || q === "journal") setView(q);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!document.querySelector("dialog[open]")) setCommand((v) => !v);
      }
      if (e.key === "Escape" && presentation) setPresentation(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [presentation]);
  const workspace = useWorkspace(data?.user?.id ?? "guest"),
    prefs = workspace.preferences;
  const all = data?.portfolios ?? [],
    active = all.find((p) => p.id === portfolioId),
    selected = useMemo(
      () =>
        portfolioId
          ? (data?.portfolios ?? []).filter((p) => p.id === portfolioId)
          : (data?.portfolios ?? []),
      [data?.portfolios, portfolioId],
    ),
    holdings = useMemo(
      () => selected.flatMap((p) => p.positions),
      [data, portfolioId],
    );
  const cash = selected.reduce((s, p) => s + p.cashBalance, 0),
    current = selected.reduce((s, p) => s + p.currentValue, 0),
    assets = useMemo(() => holdings.map(assetFromHolding), [holdings]),
    projected = totalAt(assets, cash, 1, method),
    equities = selected.reduce((s, p) => s + p.equitiesValue, 0),
    options = selected.reduce((s, p) => s + p.optionsValue, 0),
    targetCount = holdings.filter((h) => h.projection.hasTarget).length;
  const filtered = holdings.filter(
    (h) =>
      (filter === "ALL" ||
        filter === h.assetClass ||
        (filter.startsWith("SYMBOL:") &&
          (h.optionDetails?.underlying ?? h.symbol) === filter.slice(7))) &&
      (quality === "ALL" ||
        (quality === "MISSING" && !h.projection.hasTarget) ||
        (quality === "STALE" &&
          (h.projection.quoteStale || h.projection.priceEstimated))) &&
      `${h.symbol} ${h.optionDetails?.underlying ?? ""} ${all.find((p) => p.id === h.portfolioId)?.name ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const sortedPortfolios = [...all].sort(
    (a, b) =>
      Number(prefs.pinned.includes(b.id)) -
        Number(prefs.pinned.includes(a.id)) ||
      (prefs.order.indexOf(a.id) < 0 ? 999 : prefs.order.indexOf(a.id)) -
        (prefs.order.indexOf(b.id) < 0 ? 999 : prefs.order.indexOf(b.id)),
  );
  const notify = (message = "Portfolio updated") => {
    void load();
    setToast(message);
  };
  const changeView = (v: View) => {
    setView(v);
    setMobileNav(false);
    const url = new URL(location.href);
    url.searchParams.set("view", v);
    window.history.replaceState(null, "", url);
  };
  const trade = () => {
    if (active) setTicket({ portfolio: active });
    else if (all.length === 1) setTicket({ portfolio: all[0] });
    else setModal(all.length ? "portfolio-picker" : "create");
  };
  const sell = (h: Holding) => {
    const p = all.find((p) => p.id === h.portfolioId);
    if (p) setTicket({ portfolio: p, holding: h });
  };
  const clearFilters = () => {
    setFilter("ALL");
    setSearch("");
    setQuality("ALL");
  };
  const navigatePortfolio = (p: Portfolio) => {
    setMobileNav(false);
    setView("overview");
    router.push(`/portfolios/${p.id}`);
  };
  const commands: CommandItem[] = [
    {
      id: "overview",
      label: "Portfolio overview",
      detail: "See your current and target values",
      run: () => changeView("overview"),
    },
    {
      id: "studio",
      label: "Scenario studio",
      detail: "Compare your possibilities",
      run: () => changeView("studio"),
    },
    {
      id: "journal",
      label: "Thesis journal",
      detail: "Notes and evidence behind your targets",
      run: () => changeView("journal"),
    },
    {
      id: "create",
      label: "Create a portfolio",
      run: () => setModal("create"),
    },
    { id: "order", label: "New simulated order", run: trade },
    {
      id: "report",
      label: "Export investment brief",
      run: () => setReport(true),
    },
    {
      id: "settings",
      label: "Appearance & data settings",
      run: () => setModal("settings"),
    },
    ...all.map((p) => ({
      id: p.id,
      label: p.name,
      detail: "Portfolio",
      run: () => navigatePortfolio(p),
    })),
    ...holdings.map((h) => ({
      id: h.id,
      label: h.optionDetails?.underlying ?? h.symbol,
      detail: h.optionDetails
        ? `${h.optionDetails.right} · ${h.optionDetails.expiration.slice(0, 10)}`
        : "Holding",
      run: () => setDetail(h),
    })),
  ];
  const headerTitle =
    view === "studio"
      ? "Scenario studio"
      : view === "journal"
        ? "Thesis journal"
        : (active?.name ?? "Portfolio overview");
  return (
    <div
      className={`desk-shell ${styles.dashboard} ${mobileNav ? "nav-open" : ""} ${prefs.privacy ? "privacy-mode" : ""} ${presentation ? "presentation-mode" : ""}`}
    >
      <a href="#workspace-main" className="skip-to-main">
        Skip to workspace
      </a>
      <aside className="sidebar" inert={isMobile && !mobileNav}>
        <Link href="/" className="brand">
          <span
            className="brand-mark"
            aria-hidden="true"
            style={{ flexShrink: 0 }}
          >
            <BrandMonogram decorative />
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <BrandWordmark />
            <small>THE BIGGER PICTURE</small>
          </span>
        </Link>
        <button
          className="icon-button mobile-nav-close"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        >
          <X size={22} />
        </button>
        <button className="sidebar-search" onClick={() => setCommand(true)}>
          <Search size={17} />
          <span>Search the desk</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Workspace navigation">
          {[
            { id: "overview", label: "Overview", icon: LayoutDashboard },
            { id: "studio", label: "Scenario studio", icon: GitCompareArrows },
            { id: "journal", label: "Thesis journal", icon: BookOpen },
          ].map((n) => (
            <button
              key={n.id}
              className={`nav-item ${view === n.id ? "active" : ""}`}
              aria-current={view === n.id ? "page" : undefined}
              onClick={() => changeView(n.id as View)}
            >
              <n.icon size={18} />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="nav-section-label">
          <span>PORTFOLIOS</span>
          <div>
            <button
              className="icon-button"
              aria-label="Manage portfolios"
              onClick={() => setModal("manager")}
              disabled={!all.length}
            >
              <MoreHorizontal size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Create portfolio"
              onClick={() => setModal("create")}
            >
              <Plus size={17} />
            </button>
          </div>
        </div>
        <nav className="portfolio-nav" aria-label="Your portfolios">
          {sortedPortfolios
            .filter((p) => showArchived || !prefs.archived.includes(p.id))
            .map((p) => (
              <button
                key={p.id}
                className={`nav-item ${active?.id === p.id ? "portfolio-active" : ""}`}
                onClick={() => navigatePortfolio(p)}
              >
                <span className="portfolio-dot" />
                <span>{p.name}</span>
                {prefs.pinned.includes(p.id) ? (
                  <Pin size={12} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
            ))}
        </nav>
        {prefs.archived.length > 0 && (
          <button
            className="sidebar-text"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Hide" : "Show"} archived portfolios
          </button>
        )}
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setModal("settings")}>
            <Settings2 size={18} />
            Data & preferences
          </button>
          <div
            className={`sidebar-profile ${data?.user ? "" : styles.guestProfile}`}
          >
            <span className="profile-avatar">
              {(data?.user?.name ?? "Guest").slice(0, 1)}
            </span>
            <span>
              <strong>{data?.user?.name ?? "Your guest desk"}</strong>
              {data?.user && <small>Saved local workspace</small>}
            </span>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <main
        className="main-desk"
        id="workspace-main"
        inert={isMobile && mobileNav}
      >
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-nav-toggle"
              aria-label="Open workspace navigation"
              aria-expanded={mobileNav}
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              <button
                onClick={() => {
                  router.push("/dashboard");
                  changeView("overview");
                }}
              >
                Workspace
              </button>
              <ChevronRight size={13} />
              <strong>
                {active?.name ??
                  (view === "overview" ? "Overview" : headerTitle)}
              </strong>
            </div>
          </div>
          <div className="topbar-right">
            <button
              className={`status-pill ${data?.mode === "demo" ? "sample" : ""}`}
              title={
                data?.mode === "demo"
                  ? "Sample data: illustrative prices, not live quotes. Open data & preferences."
                  : data
                    ? `Provider quotes · Equity source: ${data.feeds.equityFeed}. Open data & preferences.`
                    : "Connecting to market data. Open data & preferences."
              }
              onClick={() => setModal("settings")}
            >
              <span />
              {data?.mode === "demo"
                ? "Sample data"
                : data
                  ? "Quotes"
                  : "Connecting"}
            </button>
            <button
              className="icon-button"
              aria-label="Refresh portfolio"
              disabled={refreshing}
              onClick={load}
            >
              <OrbitRefreshIcon className={refreshing ? "spin" : ""} />
            </button>
            <button
              className="icon-button desktop-only"
              aria-label={
                prefs.privacy ? "Show monetary values" : "Mask monetary values"
              }
              onClick={() =>
                workspace
                  .save("preferences", { ...prefs, privacy: !prefs.privacy })
                  .catch((e) => setError(e.message))
              }
            >
              <OrbitVisibilityIcon hidden={prefs.privacy} />
            </button>
            {data?.user ? (
              <button
                className="text-button"
                onClick={async () => {
                  const result = await authClient.signOut();
                  if (result.error) {
                    setError("Sign out failed. Please retry.");
                    return;
                  }
                  window.location.assign("/dashboard");
                }}
              >
                Sign out
              </button>
            ) : (
              <Link className="text-button" href="/sign-in">
                Sign in
                <ArrowUpRight size={14} />
              </Link>
            )}
          </div>
          <AmbientRadioControls />
        </header>
        <div className="desk-content">
          <div
            className={`page-heading ${view === "overview" ? styles.overviewHeading : ""}`}
          >
            <div>
              <h1>{headerTitle}</h1>
              {view !== "overview" && (
                <p>
                  {view === "studio"
                    ? "Explore a different future, one assumption at a time."
                    : "Keep the thinking that makes the numbers meaningful."}
                </p>
              )}
            </div>
            <div className="heading-actions">
              {all.length > 0 && (
                <button
                  className="button secondary"
                  onClick={() => setReport(true)}
                >
                  <Download size={16} />
                  Investment brief
                </button>
              )}
              <button
                className="button primary"
                onClick={all.length ? trade : () => setModal("create")}
              >
                <Plus size={17} />
                {all.length ? "New order" : "Create portfolio"}
              </button>
            </div>
          </div>
          {(error || workspace.error) && (
            <div className="error-box" role="alert">
              {error || workspace.error}
              <button
                className="text-button"
                onClick={() => {
                  void load();
                  void workspace.reload();
                }}
              >
                Retry
              </button>
            </div>
          )}
          {data && !data.user && (
            <div className="workspace-status">
              <span className="status-identity">
                <span className="status-dot" />
                Guest workspace <span className="status-divider">/</span>
                <button
                  type="button"
                  className={styles.temporary}
                  aria-expanded={expandedNotice}
                  aria-controls="guest-workspace-notice"
                  onClick={() => setExpandedNotice((v) => !v)}
                >
                  Temporary
                </button>
              </span>
              <Link className="status-save" href="/sign-up">
                {all.length ? "Save my portfolios" : "Create a profile"}
                <ArrowRight size={15} />
              </Link>
              {expandedNotice && (
                <p id="guest-workspace-notice">
                  Refreshes are safe. Guest portfolios, scenarios, and notes are
                  temporary until you save them to a profile. Ending your
                  browser session, restarting the server, or 24 hours of
                  inactivity can clear unsaved work.
                </p>
              )}
            </div>
          )}
          {data?.guest?.expired && (
            <div className="error-box" role="status">
              Your previous guest session ended. Saved profile portfolios are
              unaffected.
            </div>
          )}
          {data?.user &&
            Boolean(
              data.pendingGuest?.portfolioCount ||
              data.pendingGuest?.entryCount,
            ) && (
              <div className="workspace-status">
                <span>Guest work is ready to save to this profile.</span>
                <Link href="/sign-up" className="text-button">
                  Save guest workspace
                  <ArrowRight size={15} />
                </Link>
              </div>
            )}
          {!data ? (
            <div
              className="workspace-skeleton"
              aria-label="Loading workspace"
              role="status"
            >
              <div />
              <div />
              <div />
            </div>
          ) : portfolioId && !active ? (
            <div className="empty-state">
              <h2>This portfolio isn’t available.</h2>
              <p>Return to your overview to open another portfolio.</p>
              <Link className="button primary" href="/dashboard">
                Back to overview
              </Link>
            </div>
          ) : view === "studio" ? (
            <ScenarioStudio portfolios={selected} workspace={workspace} />
          ) : view === "journal" ? (
            <Journal
              workspace={workspace}
              portfolios={selected}
              initialSymbol={journalSymbol}
            />
          ) : (
            <>
              {!all.length ? (
                <section className="welcome-desk">
                  <div className="welcome-copy">
                    <span className="eyebrow">
                      A BLANK PAGE. A BIGGER PICTURE.
                    </span>
                    <h2>
                      Your next idea
                      <br />
                      starts <em>here.</em>
                    </h2>
                    <button
                      className="button primary"
                      onClick={() => setModal("create")}
                    >
                      Create your first portfolio
                      <ArrowUpRight size={18} />
                    </button>
                    <span className="welcome-assurance">
                      <Check size={14} />
                      No account needed. No real-money trades.
                    </span>
                  </div>
                  <div className="onboarding-steps">
                    {[
                      {
                        n: "01",
                        title: "Make room for an idea",
                        icon: Wallet,
                      },
                      {
                        n: "02",
                        title: "Build your position",
                        icon: Layers,
                      },
                      {
                        n: "03",
                        title: "Give your thesis a target",
                        icon: Target,
                      },
                    ].map((s) => (
                      <div key={s.n}>
                        <span className="step-number">{s.n}</span>
                        <div>
                          <s.icon size={24} />
                          <h3>{s.title}</h3>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                <>
                  <section className="net-worth-hero">
                    <div className="hero-current">
                      <span className="eyebrow">CURRENT PORTFOLIO VALUE</span>
                      <div className="current-value private-value">
                        {money(current, 0)}
                      </div>
                      <span className="muted">
                        {selected.length}{" "}
                        {selected.length === 1 ? "portfolio" : "portfolios"} ·{" "}
                        {holdings.length}{" "}
                        {holdings.length === 1 ? "holding" : "holdings"}
                      </span>
                    </div>
                    <span className="hero-connector">
                      <ArrowRight size={26} />
                    </span>
                    <div className="hero-main">
                      <span className="eyebrow">
                        {targetCount
                          ? `AT YOUR ${method === "model" ? "MODEL" : "INTRINSIC"} TARGETS`
                          : "A LITTLE CONVICTION GOES A LONG WAY"}
                      </span>
                      {targetCount ? (
                        <>
                          <div className="hero-value private-value">
                            {money(projected, 0)}
                          </div>
                          <div className="hero-growth">
                            <span
                              className={
                                projected >= current
                                  ? "positive-tag"
                                  : "negative-tag"
                              }
                            >
                              {projected >= current ? (
                                <ArrowUpRight size={15} />
                              ) : (
                                <ArrowDownRight size={15} />
                              )}{" "}
                              {current
                                ? `${Math.abs((projected / current - 1) * 100).toFixed(1)}%`
                                : "—"}
                            </span>
                            <span className="private-value">
                              {money(projected - current, 0)} potential change
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <h2>
                            {holdings.length
                              ? "Where could it go?"
                              : "Ready for your first holding."}
                          </h2>
                          <button
                            className="text-button"
                            onClick={() =>
                              holdings.length ? setTarget(holdings[0]) : trade()
                            }
                          >
                            {holdings.length
                              ? "Set your first target"
                              : "Add a holding"}
                            <ArrowRight size={16} />
                          </button>
                        </>
                      )}
                    </div>
                    <button
                      className="hero-aside"
                      onClick={() => {
                        setQuality("MISSING");
                        setTab("Holdings");
                        document
                          .getElementById("holdings-panel")
                          ?.scrollIntoView({
                            behavior: matchMedia(
                              "(prefers-reduced-motion: reduce)",
                            ).matches
                              ? "auto"
                              : "smooth",
                            block: "start",
                          });
                      }}
                      aria-label={`Review ${holdings.length - targetCount} holdings without targets`}
                    >
                      <Target size={21} />
                      <strong>
                        {targetCount}
                        <span> / {holdings.length}</span>
                      </strong>
                      <span>holdings targeted</span>
                      <div className="coverage-track">
                        <i
                          style={{
                            width: `${holdings.length ? (targetCount / holdings.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </button>
                  </section>
                  <div className="metrics-grid">
                    {[
                      {
                        label: "Available cash",
                        value: cash,
                        detail: active
                          ? "Manage your virtual cash"
                          : "Across selected portfolios",
                        icon: Wallet,
                        action: () =>
                          active
                            ? setModal("cash")
                            : all.length === 1
                              ? router.push(`/portfolios/${all[0].id}`)
                              : setModal("manager"),
                      },
                      {
                        label: "Equities & ETFs",
                        value: equities,
                        detail: `${holdings.filter((h) => h.assetClass === "EQUITY").length} positions`,
                        icon: BarChart3,
                        action: () => {
                          setFilter("EQUITY");
                          setTab("Holdings");
                        },
                      },
                      {
                        label: "Options value",
                        value: options,
                        detail: `${holdings.filter((h) => h.assetClass === "OPTION").length} positions`,
                        icon: Layers,
                        action: () => {
                          setFilter("OPTION");
                          setTab("Holdings");
                        },
                      },
                    ].map((m) => (
                      <button
                        className="metric-card"
                        key={m.label}
                        onClick={() => {
                          m.action();
                          if (m.label !== "Available cash")
                            document
                              .getElementById("holdings-panel")
                              ?.scrollIntoView({
                                block: "start",
                                behavior: matchMedia(
                                  "(prefers-reduced-motion:reduce)",
                                ).matches
                                  ? "auto"
                                  : "smooth",
                              });
                        }}
                      >
                        <div>
                          <span>{m.label}</span>
                          <m.icon size={18} />
                        </div>
                        <strong className="private-value">
                          {money(m.value, 0)}
                        </strong>
                        <small>
                          {m.detail}
                          <ArrowUpRight size={13} />
                        </small>
                      </button>
                    ))}
                  </div>
                  {!active && all.length > 1 && (
                    <section
                      className="portfolio-strip"
                      aria-label="Portfolio summary cards"
                    >
                      {sortedPortfolios
                        .filter((p) => !prefs.archived.includes(p.id))
                        .map((p) => (
                          <button
                            key={p.id}
                            onClick={() => navigatePortfolio(p)}
                          >
                            <span className="portfolio-card-icon">
                              <Wallet size={20} />
                            </span>
                            <div>
                              <strong>{p.name}</strong>
                              <small>
                                {p.positions.length} holdings · {p.targetCount}{" "}
                                targeted
                              </small>
                            </div>
                            <div className="portfolio-card-total">
                              <strong className="private-value">
                                {money(p.currentValue, 0)}
                              </strong>
                              <small className="private-value">
                                {money(p.projectedNetWorth, 0)} at targets
                              </small>
                            </div>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                    </section>
                  )}
                  {holdings.length > 0 && (
                    <div className="chart-grid">
                      {targetCount ? (
                        <Trajectory
                          holdings={holdings}
                          cash={cash}
                          mode={method}
                          setMode={setMethod}
                          onStudio={() => changeView("studio")}
                          onTarget={setTarget}
                        />
                      ) : (
                        <section className="panel chart-empty">
                          <span className="eyebrow">
                            TURN A POSITION INTO A PERSPECTIVE
                          </span>
                          <div className="first-target-mark">
                            <Target size={48} strokeWidth={1} />
                          </div>
                          <h2>Your holdings are just the beginning.</h2>
                          <p>
                            Set an underlying price or valuation target to
                            reveal your portfolio’s hypothetical path.
                          </p>
                          <button
                            className="button primary"
                            onClick={() => setTarget(holdings[0])}
                          >
                            Set your first target
                            <ArrowRight size={16} />
                          </button>
                        </section>
                      )}
                      <Allocation
                        holdings={holdings}
                        cash={cash}
                        filter={filter}
                        onFilter={(v) => {
                          setFilter(v);
                          setTab("Holdings");
                        }}
                      />
                    </div>
                  )}
                  <section className="panel holdings-panel" id="holdings-panel">
                    <div className="holdings-toolbar">
                      <div
                        className="tabs"
                        role="tablist"
                        aria-label="Portfolio details"
                      >
                        {["Holdings", "Activity"].map((t, i) => (
                          <button
                            key={t}
                            id={`tab-${t}`}
                            role="tab"
                            aria-selected={tab === t}
                            aria-controls={`panel-${t}`}
                            tabIndex={tab === t ? 0 : -1}
                            className={tab === t ? "active" : ""}
                            onClick={() => setTab(t)}
                            onKeyDown={(e) => {
                              if (
                                e.key === "ArrowRight" ||
                                e.key === "ArrowLeft"
                              ) {
                                e.preventDefault();
                                const next = i === 0 ? "Activity" : "Holdings";
                                setTab(next);
                                document.getElementById(`tab-${next}`)?.focus();
                              }
                            }}
                          >
                            {t}
                            {t === "Holdings" && <span>{holdings.length}</span>}
                          </button>
                        ))}
                      </div>
                      <button
                        className="text-button"
                        disabled={!holdings.length}
                        onClick={() => setReport(true)}
                      >
                        <Download size={15} />
                        Export
                      </button>
                    </div>
                    <div
                      id={`panel-${tab}`}
                      role="tabpanel"
                      aria-labelledby={`tab-${tab}`}
                    >
                      {tab === "Holdings" ? (
                        <>
                          <div className="table-filters">
                            <div
                              className="filter-pills"
                              role="group"
                              aria-label="Asset filter"
                            >
                              {[
                                ["ALL", "All assets"],
                                ["EQUITY", "Stocks / ETFs"],
                                ["OPTION", "Options"],
                              ].map(([k, label]) => (
                                <button
                                  key={k}
                                  aria-pressed={filter === k}
                                  className={filter === k ? "active" : ""}
                                  onClick={() => setFilter(k)}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <div className="table-search">
                              <Search size={15} />
                              <input
                                aria-label="Filter holdings"
                                placeholder="Symbol or portfolio…"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                              />
                              {search && (
                                <button
                                  className="icon-button"
                                  aria-label="Clear holdings search"
                                  onClick={() => setSearch("")}
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                            <select
                              aria-label="Holding quality filter"
                              value={quality}
                              onChange={(e) => setQuality(e.target.value)}
                            >
                              <option value="ALL">
                                All target / quote states
                              </option>
                              <option value="MISSING">Missing targets</option>
                              <option value="STALE">
                                Stale / estimated quotes
                              </option>
                            </select>
                          </div>
                          {(filter !== "ALL" ||
                            quality !== "ALL" ||
                            search) && (
                            <div className="active-filter-bar">
                              <span>
                                {filter === "CASH"
                                  ? "Cash allocation selected"
                                  : `${filtered.length} of ${holdings.length} holdings`}
                                {filter.startsWith("SYMBOL:")
                                  ? ` · ${filter.slice(7)}`
                                  : ""}
                                {quality === "MISSING"
                                  ? " · Missing targets"
                                  : ""}
                                {quality === "STALE"
                                  ? " · Stale / estimated"
                                  : ""}
                              </span>
                              <button
                                className="text-button"
                                onClick={clearFilters}
                              >
                                Clear filters
                                <X size={13} />
                              </button>
                            </div>
                          )}
                          {filter === "CASH" ? (
                            <div className="cash-filter">
                              <Wallet size={25} />
                              <span>Virtual cash across this view</span>
                              <strong className="private-value">
                                {money(cash)}
                              </strong>
                              <p>
                                Cash is included in portfolio value and held
                                constant in target scenarios.
                              </p>
                              <button
                                className="button secondary"
                                onClick={() =>
                                  active
                                    ? setModal("cash")
                                    : setModal("manager")
                                }
                              >
                                Manage portfolios
                              </button>
                            </div>
                          ) : (
                            <Holdings
                              holdings={filtered}
                              portfolios={selected}
                              totalCount={holdings.length}
                              onTarget={setTarget}
                              onSell={sell}
                              onDetail={setDetail}
                              onClear={clearFilters}
                              onTrade={trade}
                            />
                          )}
                          <p className="table-footnote">
                            {data.mode === "demo"
                              ? "Illustrative sample prices"
                              : "Provider quote timestamps appear in holding detail"}{" "}
                            · Refreshed{" "}
                            {new Date(data.asOf).toLocaleTimeString()} · Updates
                            every 15 seconds while visible
                          </p>
                        </>
                      ) : (
                        <Activity portfolios={selected} />
                      )}
                    </div>
                  </section>
                  <div className="workspace-next">
                    <div>
                      <Sparkles size={21} />
                      <span>
                        <strong>There’s more than one bigger picture.</strong>
                        <small>
                          Save a scenario to explore a different set of
                          assumptions.
                        </small>
                      </span>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => changeView("studio")}
                    >
                      Open scenario studio
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          <footer className="desk-footer">
            <span>
              <BrandWordmark style={{ width: 154 }} />
            </span>
            <div>
              <Link href="/methodology">Methodology</Link>
              <Link href="/privacy">Privacy</Link>
              <button onClick={() => setPresentation((v) => !v)}>
                {presentation ? "Exit presentation" : "Presentation mode"}
              </button>
            </div>
          </footer>
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss confirmation"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {presentation && (
        <div className="presentation-exit">
          <DialogRadioControl />
          <button
            className="button secondary"
            onClick={() => setPresentation(false)}
          >
            Exit presentation
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "create" && (
        <CashModal
          close={() => setModal(null)}
          saved={(id) => {
            notify("Your portfolio is ready");
            if (id) router.push(`/portfolios/${id}`);
          }}
        />
      )}
      {modal === "cash" && active && (
        <CashModal
          portfolio={active}
          close={() => setModal(null)}
          saved={() => notify("Virtual cash updated")}
        />
      )}
      {modal === "settings" && (
        <Settings
          data={data}
          workspace={workspace}
          close={() => setModal(null)}
        />
      )}
      {modal === "manager" && (
        <PortfolioManager
          portfolios={all}
          workspace={workspace}
          close={() => setModal(null)}
          saved={() => void load()}
        />
      )}
      {modal === "portfolio-picker" && (
        <DeskModal
          title="Choose a portfolio"
          kicker="Give this order a destination"
          close={() => setModal(null)}
        >
          <div className="modal-body portfolio-picker">
            {all.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setTicket({ portfolio: p });
                  setModal(null);
                }}
              >
                <span className="portfolio-card-icon">
                  <Wallet size={21} />
                </span>
                <span>
                  <strong>{p.name}</strong>
                  <small>{money(p.cashBalance)} available virtual cash</small>
                </span>
                <ArrowRight size={18} />
              </button>
            ))}
            <button className="text-button" onClick={() => setModal("create")}>
              <Plus size={15} />
              Create another portfolio
            </button>
          </div>
        </DeskModal>
      )}
      {target && (
        <TargetEditor
          holding={target}
          mode={data?.mode ?? "demo"}
          close={() => setTarget(null)}
          saved={(message) =>
            notify(
              message ??
                `${target.optionDetails?.underlying ?? target.symbol} target saved`,
            )
          }
        />
      )}
      {ticket && (
        <OrderTicket
          portfolio={ticket.portfolio}
          holding={ticket.holding}
          mode={data?.mode ?? "demo"}
          connectData={() => setModal("settings")}
          close={() => setTicket(null)}
          saved={() => notify("Simulated order filled")}
          onSetTarget={async (positionId) => {
            try {
              const fresh = await api<DeskData>("/api/desk");
              setData(fresh);
              const h = fresh.portfolios
                .flatMap((p) => p.positions)
                .find((h) => h.id === positionId);
              setTicket(null);
              if (h) setTarget(h);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}
      {detail && (
        <DeskModal
          title={detail.optionDetails?.underlying ?? detail.symbol}
          kicker="Holding detail / your conviction"
          wide
          close={() => setDetail(null)}
        >
          <div className="modal-body holding-detail">
            <div className="holding-detail-value">
              <span>Current holding value</span>
              <strong>{money(detail.projection.currentMarketValue)}</strong>
              <span
                className={
                  detail.projection.unrealizedPnL >= 0 ? "positive" : "negative"
                }
              >
                {money(detail.projection.unrealizedPnL)} unrealized
              </span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Portfolio</dt>
                <dd>{all.find((p) => p.id === detail.portfolioId)?.name}</dd>
              </div>
              <div>
                <dt>Quantity</dt>
                <dd>
                  {num(detail.quantity)}{" "}
                  {detail.optionDetails ? "contracts" : "shares"}
                </dd>
              </div>
              <div>
                <dt>Average cost</dt>
                <dd>{money(detail.avgCost)}</dd>
              </div>
              <div>
                <dt>Quote source</dt>
                <dd>
                  {detail.projection.quoteSource}
                  {detail.projection.priceEstimated
                    ? " · cost-basis estimate"
                    : detail.projection.valuationBasis === "OPTION_MIDPOINT"
                      ? " · midpoint estimate (not an execution price)"
                      : ""}
                  {detail.projection.quoteStale ? " · stale" : ""}
                  {detail.projection.expirationAssumed
                    ? " · assumed expiration time"
                    : ""}
                </dd>
              </div>
              <div>
                <dt>Quoted at</dt>
                <dd>
                  {detail.projection.quoteAsOf
                    ? new Date(detail.projection.quoteAsOf).toLocaleString()
                    : "Unavailable"}
                </dd>
              </div>
              {detail.optionDetails && (
                <div>
                  <dt>Contract</dt>
                  <dd>
                    {detail.symbol}
                    <small>
                      {detail.optionDetails.expiration.slice(0, 10)} ·{" "}
                      {detail.optionDetails.multiplier} shares / contract
                    </small>
                  </dd>
                </div>
              )}
              <div>
                <dt>At target</dt>
                <dd>
                  {money(detail.projection.projectedValue)}
                  <small>
                    {detail.projection.hasTarget
                      ? `Underlying target ${money(detail.projection.targetUnderlyingPrice)}`
                      : "No target; retains current value"}
                  </small>
                </dd>
              </div>
            </dl>
            {detail.optionDetails &&
              detail.projection.underlyingPrice != null && (
                <OptionsExplorer
                  underlying={detail.optionDetails.underlying}
                  spot={detail.projection.underlyingPrice}
                  strike={Number(detail.optionDetails.strike)}
                  right={detail.optionDetails.right}
                  expiration={detail.optionDetails.expiration}
                  premium={detail.avgCost}
                  quantity={detail.quantity}
                  iv={detail.projection.impliedVolatility ?? 0.6}
                  multiplier={detail.optionDetails.multiplier}
                />
              )}
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => {
                  setJournalSymbol(
                    detail.optionDetails?.underlying ?? detail.symbol,
                  );
                  setDetail(null);
                  changeView("journal");
                }}
              >
                <BookOpen size={16} />
                Thesis journal
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  sell(detail);
                  setDetail(null);
                }}
              >
                Sell
              </button>
              <button
                className="button primary"
                onClick={() => {
                  setTarget(detail);
                  setDetail(null);
                }}
              >
                <Target size={16} />
                Edit target
              </button>
            </div>
          </div>
        </DeskModal>
      )}
      {report && (
        <Report
          initialMasked={prefs.privacy}
          portfolios={selected}
          filtered={filtered}
          asOf={data?.asOf ?? new Date().toISOString()}
          mode={data?.mode ?? "demo"}
          close={() => setReport(false)}
        />
      )}
      {command && (
        <CommandPalette items={commands} close={() => setCommand(false)} />
      )}
    </div>
  );
}
