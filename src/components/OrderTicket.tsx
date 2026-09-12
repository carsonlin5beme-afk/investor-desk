"use client";
import { useEffect, useState, useId, useRef } from "react";
import { ArrowRight, CheckCircle2, Search, RefreshCw } from "lucide-react";
import {
  api,
  Portfolio,
  Holding,
  Contract,
  money,
  num,
} from "@/lib/desk-types";
import {
  quoteStatus,
  type QuoteStatus,
  type ClosedSessionBasis,
} from "@/lib/quote-status";
import { OrderSuccessAudio } from "@/lib/order-success-audio";
import { DeskModal } from "./DeskModal";
import { OptionsExplorer } from "./studio/OptionsExplorer";
type Quote = {
  bid: number | null;
  ask: number | null;
  mark: number | null;
  asOf: string;
  source: string;
};
type Preview = {
  fillable: boolean;
  reason?: string;
  estimatedFillPrice: number;
  estimatedNotional: number;
  cashBefore: number;
  cashAfter: number;
  quote: Quote;
  closedSession?: ClosedSessionBasis | null;
};
function requestErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Request failed. Please try again.";
}

const quoteTimeLabel = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      }).format(new Date(value))
    : "Timestamp unavailable";
const sameClosedQuote = (a: ClosedSessionBasis, b: ClosedSessionBasis) =>
  a.quoteSource === b.quoteSource &&
  a.quoteAsOf === b.quoteAsOf &&
  a.quoteBid === b.quoteBid &&
  a.quoteAsk === b.quoteAsk &&
  a.sessionDate === b.sessionDate &&
  a.nextOpen === b.nextOpen;

export function OrderTicket({
  portfolio,
  mode,
  holding,
  close,
  saved,
  connectData,
  onSetTarget,
}: {
  portfolio: Portfolio;
  mode: string;
  holding?: Holding;
  close: () => void;
  saved: () => void;
  connectData: () => void;
  onSetTarget?: (positionId: string) => void;
}) {
  const [asset, setAsset] = useState<"EQUITY" | "OPTION">(
      holding?.assetClass ?? "EQUITY",
    ),
    [side, setSide] = useState(holding ? "SELL" : "BUY"),
    [symbol, setSymbol] = useState(
      holding?.optionDetails?.underlying ?? holding?.symbol ?? "",
    ),
    [query, setQuery] = useState(
      holding?.optionDetails?.underlying ?? holding?.symbol ?? "",
    ),
    [suggestions, setSuggestions] = useState<
      { symbol: string; name: string }[]
    >([]);
  const [availability, setAvailability] = useState<QuoteStatus | null>(null);
  const [optionsAvailability, setOptionsAvailability] =
    useState<QuoteStatus | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [quote, setQuote] = useState<Quote | null>(null),
    [quantity, setQuantity] = useState(holding ? String(holding.quantity) : ""),
    [orderType, setOrderType] = useState("MARKET"),
    [limit, setLimit] = useState("");
  const [expirations, setExpirations] = useState<string[]>([]),
    [expiration, setExpiration] = useState(
      holding?.optionDetails?.expiration.slice(0, 10) ?? "",
    ),
    [right, setRight] = useState<"CALL" | "PUT">(
      holding?.optionDetails?.right ?? "CALL",
    ),
    [chain, setChain] = useState<Contract[]>([]),
    [contract, setContract] = useState<Contract | null>(
      holding?.optionDetails
        ? {
            contractSymbol: holding.symbol,
            underlying: holding.optionDetails.underlying,
            right: holding.optionDetails.right,
            strike: Number(holding.optionDetails.strike),
            expiration: holding.optionDetails.expiration,
            bid: null,
            ask: null,
            mark: null,
            impliedVolatility: null,
          }
        : null,
    );
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<{
      fillPrice: number;
      notional: number;
      portfolioCashBalance: number;
      orderId: string;
      replayed: boolean;
      quoteSource: string | null;
      quoteAsOf: string | null;
      simulationBasis: "CLOSED_SESSION_LIMIT" | "QUOTE" | null;
      position?: { id: string } | null;
    } | null>(null),
    [clientId, setClientId] = useState(""),
    [previewAt, setPreviewAt] = useState(0),
    [now, setNow] = useState(Date.now());
  const searchId = useId();
  const formId = useId();
  const [suggestionIndex, setSuggestionIndex] = useState(0),
    [suggestionNavigated, setSuggestionNavigated] = useState(false),
    [suggestionsQuery, setSuggestionsQuery] = useState(""),
    [strikeSearch, setStrikeSearch] = useState(""),
    [chainOpen, setChainOpen] = useState(!holding),
    [showPayoff, setShowPayoff] = useState(false);
  const [orderMuted, setOrderMuted] = useState(false);
  const mutedRef = useRef(false);
  const audio = useRef<OrderSuccessAudio | null>(null);
  const submitting = useRef(false);
  const prefill = useRef("");
  const [retryPending, setRetryPending] = useState(false);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  useEffect(() => {
    try {
      mutedRef.current =
        localStorage.getItem("investor-desk:order-sounds-muted:v1") === "true";
      setOrderMuted(mutedRef.current);
    } catch {
      /* Preference still works. */
    }
    return () => {
      audio.current?.dispose();
      audio.current = null;
    };
  }, []);
  const changeOrderMute = (muted: boolean) => {
    mutedRef.current = muted;
    setOrderMuted(muted);
    audio.current?.setMuted(muted);
    try {
      localStorage.setItem(
        "investor-desk:order-sounds-muted:v1",
        String(muted),
      );
    } catch {
      /* Preference still works. */
    }
  };
  const payload = {
    portfolioId: portfolio.id,
    assetClass: asset,
    symbol,
    side,
    quantity: Number(quantity),
    orderType,
    ...(orderType === "LIMIT" ? { limitPrice: Number(limit) } : {}),
    ...(asset === "OPTION" && contract
      ? {
          optionContractSymbol: contract.contractSymbol,
          optionRight: contract.right,
          optionStrike: contract.strike,
          optionExpiration: contract.expiration,
        }
      : {}),
  };
  const submission = useRef<
    | (typeof payload & {
        clientOrderId: string;
        closedSessionPreview?: ClosedSessionBasis;
      })
    | null
  >(null);
  const fingerprint = JSON.stringify(payload);
  useEffect(() => {
    if (submission.current) return;
    setPreview(null);
    setError("");
  }, [fingerprint, query]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (query === symbol || !query.trim()) {
      setSuggestions([]);
      return;
    }
    const c = new AbortController();
    const t = setTimeout(() => {
      void api<{ symbols: { symbol: string; name: string }[] }>(
        `/api/symbols/search?q=${encodeURIComponent(query)}`,
        "GET",
        undefined,
        c.signal,
      )
        .then((d) => {
          if (c.signal.aborted) return;
          setSuggestions(d.symbols);
          setSuggestionsQuery(query);
          setSuggestionIndex(0);
        })
        .catch((error: unknown) => {
          if (!c.signal.aborted) setError(requestErrorMessage(error));
        });
    }, 200);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [query, symbol]);
  useEffect(() => {
    if (!symbol) {
      setQuote(null);
      setQuoteLoading(false);
      setAvailability(null);
      return;
    }
    const c = new AbortController();
    setQuote(null);
    setAvailability(null);
    setQuoteLoading(true);
    let inFlight = false;
    const run = () => {
      if (c.signal.aborted || inFlight) return;
      inFlight = true;
      return api<{ quote: Quote | null; availability: QuoteStatus }>(
        `/api/quotes/snapshot?symbol=${encodeURIComponent(symbol)}&assetClass=EQUITY`,
        "GET",
        undefined,
        c.signal,
      )
        .then((d) => {
          if (!c.signal.aborted) {
            setQuote(d.quote);
            setAvailability(d.availability);
            setQuoteLoading(false);
          }
        })
        .catch((error: unknown) => {
          if (!c.signal.aborted) {
            const message = requestErrorMessage(error);
            setError(message);
            setQuoteLoading(false);
            setAvailability({
              code: "REFRESH_FAILED",
              label: "Quote refresh failed",
              message,
              blocking: true,
              connectionRequired: true,
            });
          }
        })
        .finally(() => {
          inFlight = false;
        });
    };
    void run();
    const t = setInterval(run, 15000);
    return () => {
      clearInterval(t);
      c.abort();
    };
  }, [symbol, quoteRefresh]);
  useEffect(() => {
    if (asset !== "OPTION" || !symbol) return;
    const c = new AbortController();
    setExpirations([]);
    setOptionsAvailability(null);
    setChain([]);
    setContract((old) => (old?.underlying === symbol ? old : null));
    void api<{ expirations: string[]; availability?: QuoteStatus }>(
      `/api/options/expirations?symbol=${encodeURIComponent(symbol)}`,
      "GET",
      undefined,
      c.signal,
    )
      .then((d) => {
        if (c.signal.aborted) return;
        setOptionsAvailability(d.availability ?? null);
        setExpirations(d.expirations);
        setExpiration((old) =>
          d.expirations.includes(old) ? old : (d.expirations[0] ?? ""),
        );
      })
      .catch((error: unknown) => {
        if (!c.signal.aborted) {
          const message = requestErrorMessage(error);
          setError(message);
          setOptionsAvailability({
            code: "REFRESH_FAILED",
            label: "Options refresh failed",
            message,
            blocking: true,
            connectionRequired: true,
          });
        }
      });
    return () => c.abort();
  }, [symbol, asset, quoteRefresh]);
  useEffect(() => {
    if (asset !== "OPTION" || !expiration) return;
    const c = new AbortController();
    setChain([]);
    setLoading(true);
    let inFlight = false;
    const run = () => {
      if (c.signal.aborted || inFlight) return;
      inFlight = true;
      return api<{ contracts: Contract[]; availability?: QuoteStatus }>(
        `/api/options/chain?symbol=${encodeURIComponent(symbol)}&expiration=${expiration}&right=${right}`,
        "GET",
        undefined,
        c.signal,
      )
        .then((d) => {
          if (c.signal.aborted) return;
          setOptionsAvailability(d.availability ?? null);
          setChain(d.contracts);
          setContract(
            (old) =>
              d.contracts.find(
                (c) => c.contractSymbol === old?.contractSymbol,
              ) ?? null,
          );
        })
        .catch((error: unknown) => {
          if (!c.signal.aborted) {
            const message = requestErrorMessage(error);
            setError(message);
            setOptionsAvailability({
              code: "REFRESH_FAILED",
              label: "Options refresh failed",
              message,
              blocking: true,
              connectionRequired: true,
            });
          }
        })
        .finally(() => {
          inFlight = false;
          if (!c.signal.aborted) setLoading(false);
        });
    };
    void run();
    const timer = setInterval(run, 15000);
    return () => {
      clearInterval(timer);
      c.abort();
    };
  }, [asset, symbol, expiration, right, quoteRefresh]);
  function chooseSymbol(s: string) {
    setSymbol(s);
    setQuery(s);
    setSuggestions([]);
    setChainOpen(true);
    setContract(null);
    setExpiration("");
    setQuantity("");
  }
  const executable = asset === "OPTION" ? contract : quote;
  const price = side === "BUY" ? executable?.ask : executable?.bid;
  const owned =
    portfolio.positions.find(
      (p) =>
        p.symbol === (asset === "OPTION" ? contract?.contractSymbol : symbol) &&
        p.assetClass === asset,
    )?.quantity ?? 0;
  const estimated =
    Number(quantity) * (price ?? 0) * (asset === "OPTION" ? 100 : 1);
  const closed = asset === "EQUITY" ? availability?.closedSession : undefined;
  const closedValid = Boolean(
    closed &&
    quote &&
    Date.parse(closed.validUntil) > now &&
    Date.parse(closed.nextOpen) > now &&
    closed.quoteSource === quote.source &&
    closed.quoteAsOf === quote.asOf &&
    closed.quoteBid === quote.bid &&
    closed.quoteAsk === quote.ask,
  );
  useEffect(() => {
    if (!closed || submitting.current || retryPending) return;
    const key = `${asset}:${symbol}:${side}:${closed.sessionDate}`;
    if (closedValid && quote && prefill.current !== key) {
      prefill.current = key;
      setOrderType("LIMIT");
      setLimit(String(side === "BUY" ? quote.ask : quote.bid));
    }
  }, [asset, symbol, side, closed, closedValid, quote, retryPending]);
  const activeStatus =
    asset === "OPTION"
      ? (optionsAvailability ??
        (contract
          ? quoteStatus({
              symbol: contract.contractSymbol,
              source: contract.source ?? (mode === "demo" ? "demo" : "unknown"),
              asOf: contract.asOf,
              hasQuote: true,
              now,
            })
          : null))
      : closed
        ? closedValid
          ? availability
          : {
              ...availability!,
              label: "Quote needs refresh",
              message:
                "Refresh the quote to verify the current market session.",
              blocking: true,
            }
        : availability?.blocking
          ? availability
          : quote
            ? quoteStatus({
                symbol,
                source: quote.source,
                asOf: quote.asOf,
                hasQuote: true,
                now,
              })
            : availability;
  const validPrice = price != null && Number.isFinite(price) && price > 0;
  const previewBlocker = !symbol
    ? "Choose a symbol to begin."
    : query !== symbol
      ? "Select a ticker or press Enter to confirm it."
      : activeStatus?.blocking
        ? activeStatus.message
        : closed && orderType !== "LIMIT"
          ? "Use a limit order with this closed-session quote."
          : orderType === "LIMIT" &&
              (!Number.isFinite(Number(limit)) || Number(limit) <= 0)
            ? "Enter a positive limit price."
            : asset === "OPTION" && !contract
              ? "Choose an expiration and select an option contract."
              : !validPrice
                ? quoteLoading
                  ? "Loading a quote..."
                  : "A positive bid/ask quote is required before previewing an order."
                : !Number.isFinite(Number(quantity)) || Number(quantity) <= 0
                  ? "Enter the number of shares or contracts to trade."
                  : asset === "OPTION" && !Number.isInteger(Number(quantity))
                    ? "Options require a whole number of contracts."
                    : "";
  async function review(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current || retryPending) return;
    if (previewBlocker) {
      setError(previewBlocker);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const data = await api<{ preview: Preview }>(
        "/api/orders/preview",
        "POST",
        payload,
      );
      if (!data.preview.fillable) throw new Error(data.preview.reason);
      setPreview(data.preview);
      setClientId(crypto.randomUUID());
      setPreviewAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  function previewExpired(at: number) {
    if (!preview) return false;
    if (at - previewAt >= 60000) return true;
    if (preview.closedSession)
      return (
        Date.parse(preview.closedSession.validUntil) <= at ||
        Date.parse(preview.closedSession.nextOpen) <= at ||
        !closedValid ||
        !closed ||
        !sameClosedQuote(preview.closedSession, closed)
      );
    return Boolean(closed);
  }
  async function execute() {
    if (submitting.current) return;
    if (
      !submission.current &&
      (!preview || query !== symbol || previewExpired(Date.now()))
    ) {
      setPreview(null);
      return;
    }
    submission.current ??= {
      ...payload,
      clientOrderId: clientId,
      ...(preview?.closedSession
        ? { closedSessionPreview: preview.closedSession }
        : {}),
    };
    submitting.current = true;
    setBusy(true);
    setError("");
    audio.current ??= new OrderSuccessAudio();
    audio.current.setMuted(mutedRef.current);
    const audioAttempt = audio.current.prepare();
    try {
      const data = await api<{ execution: NonNullable<typeof result> }>(
        "/api/orders/execute",
        "POST",
        submission.current,
      );
      submission.current = null;
      setRetryPending(false);
      setResult(data.execution);
      audio.current.success(
        audioAttempt,
        data.execution.orderId,
        data.execution.replayed !== false,
      );
      saved();
    } catch (e) {
      audio.current?.cancel(audioAttempt);
      const ambiguous = e instanceof TypeError || e instanceof SyntaxError;
      setRetryPending(ambiguous);
      if (!ambiguous) {
        submission.current = null;
        setPreview(null);
      }
      setError(
        ambiguous
          ? "The response was interrupted. Check the same order submission before placing another order."
          : requestErrorMessage(e),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const expired = previewExpired(now);
  return (
    <DeskModal
      title={result ? "Order filled" : "Trade simulator"}
      kicker={`${portfolio.name} / ${mode === "demo" ? "Sample prices" : "Market data"}`}
      close={close}
      wide
      busy={busy}
      footer={
        !result ? (
          <footer className="modal-actions ticket-actions">
            <label className="order-sounds">
              <input
                type="checkbox"
                checked={!orderMuted}
                onChange={(event) => changeOrderMute(!event.target.checked)}
              />
              Order sounds
            </label>
            <div className="ticket-sticky-summary">
              <small>
                {side === "BUY" ? "Estimated debit" : "Estimated credit"} ·{" "}
                {portfolio.name}
              </small>
              <strong
                className={
                  validPrice && !activeStatus?.blocking
                    ? "numeric-highlight"
                    : undefined
                }
              >
                {validPrice ? money(estimated) : "Choose an instrument"}
              </strong>
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </button>
            {retryPending || (preview && !expired) ? (
              <button
                className="button primary order-confirm"
                type="button"
                onClick={execute}
                disabled={busy}
              >
                {busy
                  ? "Executing..."
                  : retryPending
                    ? "Check order result"
                    : preview?.closedSession
                      ? "Simulate limit order"
                      : "Execute simulated order"}
                <ArrowRight size={17} />
              </button>
            ) : (
              <button
                className="button primary"
                type="submit"
                form={formId}
                aria-describedby={
                  !preview && previewBlocker && !activeStatus?.blocking
                    ? "preview-help"
                    : undefined
                }
                disabled={busy || Boolean(previewBlocker)}
              >
                {busy
                  ? "Checking..."
                  : expired && preview
                    ? "Refresh preview"
                    : "Preview order"}
                {busy ? (
                  <RefreshCw className="spin" size={17} />
                ) : (
                  <ArrowRight size={17} />
                )}
              </button>
            )}
          </footer>
        ) : undefined
      }
    >
      {result ? (
        <div className="modal-body success-state ticket-success">
          <CheckCircle2 size={48} />
          <h3>
            {result.replayed
              ? "This order was already confirmed."
              : "Your portfolio is updated."}
          </h3>
          <p>
            {side === "BUY" ? "Bought" : "Sold"} {num(Number(quantity))}{" "}
            {asset === "OPTION" ? "contracts of" : "shares of"} {symbol} at{" "}
            {money(result.fillPrice)}.
          </p>
          <div className="scenario-preview">
            <span>Total {side === "BUY" ? "debit" : "credit"}</span>
            <strong>{money(result.notional)}</strong>
            <span>
              {result.replayed ? "Current cash balance" : "Cash remaining"}
            </span>
            <strong>{money(result.portfolioCashBalance)}</strong>
          </div>
          <p className="fine-print">
            Simulation only. No order was sent to a broker.
          </p>
          {result.quoteAsOf && (
            <p className="execution-provenance">
              {result.simulationBasis === "CLOSED_SESSION_LIMIT"
                ? "Closed-session limit simulation · Last available quote"
                : "Execution quote"}
              <br />
              {result.quoteSource} · {quoteTimeLabel(result.quoteAsOf)}
            </p>
          )}
          <div className="receipt-actions">
            {result.position && onSetTarget && (
              <button
                className="button primary"
                type="button"
                onClick={() => onSetTarget(result.position!.id)}
              >
                Set a target
                <ArrowRight size={17} />
              </button>
            )}
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setResult(null);
                setPreview(null);
                setQuantity("");
              }}
            >
              Another order
            </button>
            <button className="button secondary" onClick={close}>
              Back to portfolio
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      ) : (
        <form id={formId} className="modal-body trade-ticket" onSubmit={review}>
          <fieldset disabled={busy || retryPending}>
            <div className="ticket-top">
              <div className="segmented">
                <button
                  type="button"
                  aria-pressed={asset === "EQUITY"}
                  className={asset === "EQUITY" ? "active" : ""}
                  onClick={() => {
                    setAsset("EQUITY");
                    setContract(null);
                  }}
                >
                  Stocks / ETFs
                </button>
                <button
                  type="button"
                  aria-pressed={asset === "OPTION"}
                  className={asset === "OPTION" ? "active" : ""}
                  onClick={() => setAsset("OPTION")}
                >
                  Options
                </button>
              </div>
              <div className="buying-power">
                <small>Available cash</small>
                <strong>{money(portfolio.cashBalance)}</strong>
              </div>
            </div>
            <div className="ticket-grid">
              <div className="symbol-search">
                <label>
                  Symbol or company
                  <div className="input-icon">
                    <Search size={17} />
                    <input
                      role="combobox"
                      aria-expanded={suggestions.length > 0}
                      aria-controls={searchId}
                      aria-autocomplete="list"
                      aria-activedescendant={
                        suggestions[suggestionIndex]
                          ? `${searchId}-${suggestionIndex}`
                          : undefined
                      }
                      autoComplete="off"
                      placeholder="Ticker or company name"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value.toUpperCase());
                        setSuggestionNavigated(false);
                        setSuggestions([]);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                          e.preventDefault();
                          setSuggestionNavigated(true);
                          setSuggestionIndex(
                            (i) =>
                              (i +
                                (e.key === "ArrowDown" ? 1 : -1) +
                                Math.max(suggestions.length, 1)) %
                              Math.max(suggestions.length, 1),
                          );
                        }
                        if (e.key === "Escape" && suggestions.length) {
                          e.preventDefault();
                          e.stopPropagation();
                          setSuggestions([]);
                        }
                        if (e.key === "Enter" && query !== symbol) {
                          e.preventDefault();
                          chooseSymbol(
                            suggestionsQuery !== query
                              ? query.trim()
                              : suggestionNavigated
                                ? (suggestions[suggestionIndex]?.symbol ??
                                  query.trim())
                                : (suggestions.find(
                                    (item) => item.symbol === query.trim(),
                                  )?.symbol ??
                                  suggestions[0]?.symbol ??
                                  query.trim()),
                          );
                        }
                      }}
                      onBlur={() => {
                        if (
                          query.trim() &&
                          query !== symbol &&
                          !suggestions.length
                        )
                          chooseSymbol(query.trim());
                      }}
                    />
                  </div>
                </label>
                {suggestions.length > 0 && (
                  <div
                    className="suggestions"
                    id={searchId}
                    role="listbox"
                    aria-label="Matching instruments"
                  >
                    {suggestions.map((s, index) => (
                      <button
                        type="button"
                        key={s.symbol}
                        id={`${searchId}-${index}`}
                        role="option"
                        aria-selected={index === suggestionIndex}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => chooseSymbol(s.symbol)}
                      >
                        <strong>{s.symbol}</strong>
                        <span>{s.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <label>
                Action
                <select value={side} onChange={(e) => setSide(e.target.value)}>
                  <option value="BUY">
                    {asset === "OPTION" ? "Buy to open" : "Buy"}
                  </option>
                  <option value="SELL">
                    {asset === "OPTION" ? "Sell to close" : "Sell"}
                  </option>
                </select>
              </label>
            </div>
            {!symbol && (
              <div className="ticket-intro">
                <p>
                  Start with a symbol, then choose the position you want to
                  build.
                </p>
                {mode === "demo" && (
                  <div className="sample-symbols">
                    <span>Explore sample instruments</span>
                    {["PL", "TSLA", "AAPL", "SPY", "BTG"].map((s) => (
                      <button
                        type="button"
                        key={s}
                        onClick={() => chooseSymbol(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {symbol && (
              <div className="quote-strip">
                <strong>{symbol}</strong>
                <span>
                  Mark <b>{money(quote?.mark)}</b>
                </span>
                <span>
                  Bid <b>{money(quote?.bid)}</b>
                </span>
                <span>
                  Ask <b>{money(quote?.ask)}</b>
                </span>
                <small>
                  {mode === "demo"
                    ? "ILLUSTRATIVE PRICES"
                    : quote
                      ? `${quote.source} · ${quoteTimeLabel(quote.asOf)}`
                      : "QUOTE UNAVAILABLE"}
                </small>
              </div>
            )}
            {activeStatus && (
              <div
                className={`quote-notice ticket-quote-status ${activeStatus.blocking ? "blocking" : "compact-notice"}`}
                role="status"
              >
                <strong>{activeStatus.label}</strong>
                <p>
                  {closedValid
                    ? "Last available quote · Simulated limit orders only."
                    : activeStatus.message}
                </p>
                {activeStatus.blocking && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setQuoteRefresh((value) => value + 1)}
                  >
                    Refresh quote
                  </button>
                )}
                {activeStatus.code === "DEMO_UNAVAILABLE" && (
                  <div className="sample-symbols">
                    <span>Try an illustrative sample</span>
                    {["PL", "TSLA", "AAPL", "SPY", "BTG"].map((sample) => (
                      <button
                        type="button"
                        key={sample}
                        onClick={() => chooseSymbol(sample)}
                      >
                        {sample}
                      </button>
                    ))}
                  </div>
                )}
                {activeStatus.connectionRequired && mode !== "demo" && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={connectData}
                  >
                    Review data connection
                  </button>
                )}
              </div>
            )}
            {asset === "OPTION" && symbol && (
              <>
                <div className="ticket-grid">
                  <label>
                    Expiration
                    <select
                      value={expiration}
                      onChange={(e) => {
                        setExpiration(e.target.value);
                        setContract(null);
                        setChainOpen(true);
                        setStrikeSearch("");
                      }}
                    >
                      <option value="" disabled>
                        Select expiration
                      </option>
                      {expirations.map((e) => (
                        <option key={e} value={e}>
                          {e} ·{" "}
                          {Math.max(
                            0,
                            Math.ceil(
                              (new Date(e).getTime() - Date.now()) / 86400000,
                            ),
                          )}{" "}
                          days
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Option right
                    <select
                      value={right}
                      onChange={(e) => {
                        setRight(e.target.value as "CALL" | "PUT");
                        setContract(null);
                        setChainOpen(true);
                        setStrikeSearch("");
                      }}
                    >
                      <option value="CALL">Call</option>
                      <option value="PUT">Put</option>
                    </select>
                  </label>
                </div>
                <div className="chain-heading">
                  <strong>Select a contract</strong>
                  <small>Premium per share · 100 shares / contract</small>
                </div>
                {contract && (
                  <button
                    type="button"
                    className="text-button change-contract"
                    onClick={() => setChainOpen((v) => !v)}
                  >
                    {chainOpen ? "Keep selected contract" : "Change contract"}:{" "}
                    {contract.underlying} {money(contract.strike)}{" "}
                    {contract.right.toLowerCase()}
                  </button>
                )}
                {chainOpen && (
                  <>
                    <label className="strike-filter">
                      Find a strike
                      <input
                        aria-label="Filter option strikes"
                        type="search"
                        value={strikeSearch}
                        placeholder="Strike price…"
                        onChange={(e) => setStrikeSearch(e.target.value)}
                      />
                    </label>
                    <div className="chain-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Strike</th>
                            <th>Bid</th>
                            <th>Ask</th>
                            <th>IV</th>
                            <th>Selection</th>
                          </tr>
                        </thead>
                        <tbody>
                          {chain
                            .filter(
                              (c) =>
                                !strikeSearch ||
                                String(c.strike).includes(strikeSearch),
                            )
                            .map((c) => (
                              <tr
                                key={c.contractSymbol}
                                className={`${contract?.contractSymbol === c.contractSymbol ? "selected-row" : ""} ${quote?.mark && Math.abs(c.strike - quote.mark) === Math.min(...chain.map((v) => Math.abs(v.strike - (quote.mark ?? 0)))) ? "atm-row" : ""}`}
                              >
                                <td>
                                  {money(c.strike)}
                                  {quote?.mark &&
                                  Math.abs(c.strike - quote.mark) ===
                                    Math.min(
                                      ...chain.map((v) =>
                                        Math.abs(v.strike - (quote.mark ?? 0)),
                                      ),
                                    ) ? (
                                    <small>At the money</small>
                                  ) : null}
                                </td>
                                <td>{money(c.bid)}</td>
                                <td>{money(c.ask)}</td>
                                <td>
                                  {c.impliedVolatility == null
                                    ? "N/A"
                                    : `${(c.impliedVolatility * 100).toFixed(0)}%`}
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="contract-button"
                                    aria-label={`Select ${c.right.toLowerCase()} strike ${c.strike}`}
                                    aria-pressed={
                                      contract?.contractSymbol ===
                                      c.contractSymbol
                                    }
                                    onClick={() => {
                                      setContract(c);
                                      setChainOpen(false);
                                    }}
                                  >
                                    {contract?.contractSymbol ===
                                    c.contractSymbol
                                      ? "Selected"
                                      : "Select"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {chain.length > 0 &&
                        strikeSearch &&
                        !chain.some((c) =>
                          String(c.strike).includes(strikeSearch),
                        ) && (
                          <div className="chain-empty">
                            <p>No strikes match “{strikeSearch}”.</p>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => setStrikeSearch("")}
                            >
                              Clear strike filter
                            </button>
                          </div>
                        )}
                      {!chain.length && (
                        <p className="chain-empty">
                          {loading
                            ? "Loading option chain..."
                            : mode === "demo"
                              ? "Choose a sample symbol and expiration to view contracts."
                              : "No contracts returned. Check the selected provider credentials, expiration, and market-data access."}
                        </p>
                      )}
                    </div>
                  </>
                )}
                {contract && (
                  <div className="selected-contract">
                    {contract.underlying} {money(contract.strike)}{" "}
                    {contract.right.toLowerCase()} · {expiration}{" "}
                    <span>{contract.contractSymbol}</span>
                    <small>
                      {contract.source === "demo"
                        ? "Sample option prices"
                        : `${contract.source ?? "Unknown source"} / ${contract.asOf ? new Date(contract.asOf).toLocaleString() : "Timestamp unavailable"}`}
                    </small>
                  </div>
                )}
              </>
            )}
            <div className="ticket-grid three">
              <label>
                {asset === "OPTION" ? "Contracts" : "Shares"}
                <input
                  required
                  type="number"
                  min={asset === "OPTION" ? 1 : 0.000001}
                  step={asset === "OPTION" ? 1 : 0.000001}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder={
                    asset === "OPTION" ? "Enter contracts" : "Enter shares"
                  }
                />
              </label>
              <label>
                Order type
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value)}
                >
                  <option value="MARKET" disabled={Boolean(closed)}>
                    Market
                  </option>
                  <option value="LIMIT">Limit (immediate or cancel)</option>
                </select>
              </label>
              {orderType === "LIMIT" ? (
                <label>
                  Limit price ($)
                  <input
                    required
                    min="0.000001"
                    step="any"
                    type="number"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                  />
                </label>
              ) : (
                <div className="quantity-help">
                  <small>Owned: {num(owned)}</small>
                  <button
                    className="text-button"
                    type="button"
                    disabled={!validPrice || Boolean(activeStatus?.blocking)}
                    onClick={() =>
                      setQuantity(
                        String(
                          side === "SELL"
                            ? owned
                            : Math.max(
                                0,
                                Math.floor(
                                  portfolio.cashBalance /
                                    ((validPrice ? price! : Infinity) *
                                      (asset === "OPTION" ? 100 : 1)),
                                ),
                              ),
                        ),
                      )
                    }
                  >
                    {side === "SELL" ? "Sell all" : "Use max quantity"}
                  </button>
                </div>
              )}
            </div>
            {validPrice && (
              <div
                className="quantity-presets"
                role="group"
                aria-label="Position size presets"
              >
                {[0.25, 0.5, 1].map((fraction) => (
                  <button
                    type="button"
                    key={fraction}
                    onClick={() =>
                      setQuantity(
                        String(
                          side === "SELL"
                            ? asset === "OPTION"
                              ? Math.floor(owned * fraction)
                              : Number((owned * fraction).toFixed(6))
                            : Math.max(
                                0,
                                Math.floor(
                                  (portfolio.cashBalance * fraction) /
                                    (price! * (asset === "OPTION" ? 100 : 1)),
                                ),
                              ),
                        ),
                      )
                    }
                  >
                    {fraction === 1
                      ? side === "SELL"
                        ? "Sell all"
                        : "Max"
                      : `${fraction * 100}%`}
                  </button>
                ))}
              </div>
            )}
            {orderType === "LIMIT" && (
              <p className="info-box">
                Immediate or cancel: a buy needs an ask at or below your limit;
                a sell needs a bid at or above it. An uncrossed order will not
                wait in a queue.
              </p>
            )}
            <div className="estimate-row">
              <span>Estimated {side === "BUY" ? "debit" : "credit"}</span>
              <strong
                className={
                  validPrice && !activeStatus?.blocking
                    ? "numeric-highlight"
                    : undefined
                }
              >
                {price != null ? money(estimated) : "No executable quote"}
              </strong>
            </div>
            {asset === "OPTION" && contract && side === "BUY" && (
              <p className="fine-print">
                Expiration break-even:{" "}
                {price == null
                  ? "N/A"
                  : money(
                      contract.strike + (right === "CALL" ? price : -price),
                    )}
                . Maximum loss: premium paid.{" "}
                {right === "CALL"
                  ? "Call upside is theoretically unlimited."
                  : "Put upside is limited by an underlying price of $0."}
              </p>
            )}
            {asset === "OPTION" &&
              side === "BUY" &&
              contract &&
              quote?.mark != null &&
              price != null && (
                <details
                  className="disclosure ticket-payoff"
                  open={showPayoff}
                  onToggle={(e) => setShowPayoff(e.currentTarget.open)}
                >
                  <summary>Explore payoff & sensitivity</summary>
                  {showPayoff && (
                    <OptionsExplorer
                      key={contract.contractSymbol}
                      spot={quote.mark}
                      strike={contract.strike}
                      right={right}
                      expiration={expiration}
                      premium={price}
                      iv={contract.impliedVolatility ?? 0.6}
                      quantity={Number(quantity) || 1}
                    />
                  )}
                </details>
              )}
            <p className="fine-print">
              No brokerage connection. Long positions only. Zero fees. Market
              buys fill at ask; sells at bid. Uncrossed limits are not queued.
              Prices can change between preview and execution.
            </p>
          </fieldset>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          {preview && (
            <div className="review-box" role="status">
              <div>
                <CheckCircle2 size={18} />
                <strong>Review your simulated order</strong>
              </div>
              <p>
                {side} {num(Number(quantity))}{" "}
                {asset === "OPTION" ? "contracts" : "shares"} of {symbol} at
                approximately {money(preview.estimatedFillPrice)}.
                {contract && (
                  <span>
                    {" "}
                    {contract.right} · {money(contract.strike)} strike ·{" "}
                    {expiration}.
                  </span>
                )}
              </p>
              {preview.closedSession && (
                <p className="execution-provenance">
                  Uses the last available quote while the regular session is
                  closed.
                  <br />
                  {preview.closedSession.quoteSource} ·{" "}
                  {quoteTimeLabel(preview.closedSession.quoteAsOf)}
                </p>
              )}
              <div className="scenario-preview">
                <span>Estimated cash after fill</span>
                <strong>{money(preview.cashAfter)}</strong>
              </div>
              <small>
                {expired
                  ? "Preview expired. Refresh before executing."
                  : `Preview valid for ${Math.min(60, Math.max(0, Math.ceil((Math.min(previewAt + 60000, preview.closedSession ? Date.parse(preview.closedSession.validUntil) : Infinity) - now) / 1000)))}s. ${preview.closedSession ? "Execution rechecks this quote and market session." : "Execution refreshes the quote."}`}
              </small>
            </div>
          )}
          {!preview && previewBlocker && !activeStatus?.blocking && (
            <p className="fine-print" id="preview-help">
              {previewBlocker}
            </p>
          )}
        </form>
      )}
    </DeskModal>
  );
}
