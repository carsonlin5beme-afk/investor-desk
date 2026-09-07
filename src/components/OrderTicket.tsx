"use client";
import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Search, RefreshCw } from "lucide-react";
import {
  api,
  Portfolio,
  Holding,
  Contract,
  money,
  num,
} from "@/lib/desk-types";
import { DeskModal } from "./DeskModal";
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
};
export function OrderTicket({
  portfolio,
  mode,
  holding,
  close,
  saved,
}: {
  portfolio: Portfolio;
  mode: string;
  holding?: Holding;
  close: () => void;
  saved: () => void;
}) {
  const [asset, setAsset] = useState<"EQUITY" | "OPTION">(
      holding?.assetClass ?? "EQUITY",
    ),
    [side, setSide] = useState(holding ? "SELL" : "BUY"),
    [symbol, setSymbol] = useState(
      holding?.optionDetails?.underlying ?? holding?.symbol ?? "TSLA",
    ),
    [query, setQuery] = useState(
      holding?.optionDetails?.underlying ?? holding?.symbol ?? "TSLA",
    ),
    [suggestions, setSuggestions] = useState<
      { symbol: string; name: string }[]
    >([]);
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
    } | null>(null),
    [clientId, setClientId] = useState(""),
    [previewAt, setPreviewAt] = useState(0),
    [now, setNow] = useState(Date.now());
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
  const fingerprint = JSON.stringify(payload);
  useEffect(() => {
    setPreview(null);
    setError("");
  }, [fingerprint, query]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (query === symbol) {
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
        .then((d) => setSuggestions(d.symbols))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [query, symbol]);
  useEffect(() => {
    const c = new AbortController();
    setQuote(null);
    const run = () =>
      api<{ quote: Quote | null }>(
        `/api/quotes/snapshot?symbol=${encodeURIComponent(symbol)}&assetClass=EQUITY`,
        "GET",
        undefined,
        c.signal,
      )
        .then((d) => setQuote(d.quote))
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
    void run();
    const t = setInterval(run, 15000);
    return () => {
      c.abort();
      clearInterval(t);
    };
  }, [symbol]);
  useEffect(() => {
    if (asset !== "OPTION") return;
    const c = new AbortController();
    setExpirations([]);
    void api<{ expirations: string[] }>(
      `/api/options/expirations?symbol=${encodeURIComponent(symbol)}`,
      "GET",
      undefined,
      c.signal,
    )
      .then((d) => {
        setExpirations(d.expirations);
        setExpiration((old) =>
          d.expirations.includes(old) ? old : (d.expirations[0] ?? ""),
        );
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [symbol, asset]);
  useEffect(() => {
    if (asset !== "OPTION" || !expiration) return;
    const c = new AbortController();
    setChain([]);
    setLoading(true);
    void api<{ contracts: Contract[] }>(
      `/api/options/chain?symbol=${encodeURIComponent(symbol)}&expiration=${expiration}&right=${right}`,
      "GET",
      undefined,
      c.signal,
    )
      .then((d) => {
        setChain(d.contracts);
        setContract(
          (old) =>
            d.contracts.find((c) => c.contractSymbol === old?.contractSymbol) ??
            null,
        );
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [asset, symbol, expiration, right]);
  function chooseSymbol(s: string) {
    setSymbol(s);
    setQuery(s);
    setSuggestions([]);
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
  async function review(e: React.FormEvent) {
    e.preventDefault();
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
      setBusy(false);
    }
  }
  async function execute() {
    if (!preview || query !== symbol || Date.now() - previewAt > 60000) {
      setPreview(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api<{ execution: NonNullable<typeof result> }>(
        "/api/orders/execute",
        "POST",
        { ...payload, clientOrderId: clientId },
      );
      setResult(data.execution);
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const expired = now - previewAt > 60000;
  return (
    <DeskModal
      title={result ? "Order filled" : "Trade simulator"}
      kicker={`${portfolio.name} / ${mode === "demo" ? "Sample prices" : "Market data"}`}
      close={close}
      wide
      busy={busy}
    >
      {result ? (
        <div className="modal-body success-state">
          <CheckCircle2 size={48} />
          <h3>Your portfolio is updated.</h3>
          <p>
            {side === "BUY" ? "Bought" : "Sold"} {num(Number(quantity))}{" "}
            {asset === "OPTION" ? "contracts of" : "shares of"} {symbol} at{" "}
            {money(result.fillPrice)}.
          </p>
          <div className="scenario-preview">
            <span>Total {side === "BUY" ? "debit" : "credit"}</span>
            <strong>{money(result.notional)}</strong>
            <span>Cash remaining</span>
            <strong>{money(result.portfolioCashBalance)}</strong>
          </div>
          <p className="fine-print">
            Simulation only. No order was sent to a broker.
          </p>
          <button className="button primary" onClick={close}>
            Back to portfolio
            <ArrowRight size={17} />
          </button>
        </div>
      ) : (
        <form className="modal-body" onSubmit={review}>
          <fieldset disabled={busy}>
            <div className="ticket-top">
              <div className="segmented">
                <button
                  type="button"
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
                      value={query}
                      onChange={(e) => setQuery(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && query !== symbol) {
                          e.preventDefault();
                          chooseSymbol(query.trim());
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
                  <div className="suggestions">
                    {suggestions.map((s) => (
                      <button
                        type="button"
                        key={s.symbol}
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
                    ? `${quote.source} · ${new Date(quote.asOf).toLocaleTimeString()}`
                    : "QUOTE UNAVAILABLE"}
              </small>
            </div>
            {asset === "OPTION" && (
              <>
                <div className="ticket-grid">
                  <label>
                    Expiration
                    <select
                      value={expiration}
                      onChange={(e) => {
                        setExpiration(e.target.value);
                        setContract(null);
                      }}
                    >
                      <option value="" disabled>
                        Select expiration
                      </option>
                      {expirations.map((e) => (
                        <option key={e}>{e}</option>
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
                      {chain.map((c) => (
                        <tr
                          key={c.contractSymbol}
                          className={
                            contract?.contractSymbol === c.contractSymbol
                              ? "selected-row"
                              : ""
                          }
                        >
                          <td>{money(c.strike)}</td>
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
                              onClick={() => setContract(c)}
                            >
                              {contract?.contractSymbol === c.contractSymbol
                                ? "Selected"
                                : "Select"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                {contract && (
                  <div className="selected-contract">
                    {contract.underlying} {money(contract.strike)}{" "}
                    {contract.right.toLowerCase()} · {expiration}{" "}
                    <span>{contract.contractSymbol}</span>
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
                  placeholder={asset === "OPTION" ? "600" : "228"}
                />
              </label>
              <label>
                Order type
                <select
                  value={orderType}
                  onChange={(e) => setOrderType(e.target.value)}
                >
                  <option value="MARKET">Market</option>
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
                    onClick={() =>
                      setQuantity(
                        String(
                          side === "SELL"
                            ? owned
                            : Math.max(
                                0,
                                Math.floor(
                                  portfolio.cashBalance /
                                    ((price ?? Infinity) *
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
            <div className="estimate-row">
              <span>Estimated {side === "BUY" ? "debit" : "credit"}</span>
              <strong>
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
            <div className="review-box">
              <div>
                <CheckCircle2 size={18} />
                <strong>Review your simulated order</strong>
              </div>
              <p>
                {side} {num(Number(quantity))}{" "}
                {asset === "OPTION" ? "contracts" : "shares"} of {symbol} at
                approximately {money(preview.estimatedFillPrice)}.
              </p>
              <div className="scenario-preview">
                <span>Estimated cash after fill</span>
                <strong>{money(preview.cashAfter)}</strong>
              </div>
              <small>
                {expired
                  ? "Preview expired. Refresh before executing."
                  : `Preview valid for ${Math.max(0, 60 - Math.floor((now - previewAt) / 1000))}s. Execution uses a fresh quote.`}
              </small>
            </div>
          )}
          <footer className="modal-actions">
            <button
              className="button secondary"
              type="button"
              onClick={close}
              disabled={busy}
            >
              Cancel
            </button>
            {preview && !expired ? (
              <button
                className="button primary"
                type="button"
                onClick={execute}
                disabled={busy}
              >
                {busy ? "Executing..." : "Execute simulated order"}
                <ArrowRight size={17} />
              </button>
            ) : (
              <button
                className="button primary"
                type="submit"
                disabled={
                  busy ||
                  !quantity ||
                  query !== symbol ||
                  (asset === "OPTION" && !contract)
                }
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
        </form>
      )}
    </DeskModal>
  );
}
