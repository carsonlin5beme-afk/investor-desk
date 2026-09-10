"use client";
import { useEffect, useState } from "react";
import { Target, ArrowRight, RotateCcw, Check } from "lucide-react";
import { api, type Holding, money, num } from "@/lib/desk-types";
import { assetFromHolding, valueAt } from "@/lib/studio";
import { DeskModal } from "./DeskModal";
import { Segmented } from "./studio/Controls";
export function TargetEditor({
  holding,
  mode,
  close,
  saved,
}: {
  holding: Holding;
  mode: string;
  close: () => void;
  saved: (message?: string) => void;
}) {
  const original = holding.targetScenario,
    symbol = holding.optionDetails?.underlying ?? holding.symbol,
    knownEtf = ["SPY", "QQQ", "VOO"].includes(symbol);
  const [kind, setKind] = useState<"PRICE" | "MARKET_CAP">(
      knownEtf ? "PRICE" : (original?.targetMode ?? "PRICE"),
    ),
    [price, setPrice] = useState(original?.targetPrice ?? ""),
    [cap, setCap] = useState(
      original?.targetMarketCap
        ? String(Number(original.targetMarketCap) / 1e9)
        : "",
    ),
    [manual, setManual] = useState(original?.useManualShares ?? false),
    [shares, setShares] = useState(
      original?.sharesOutstandingManual
        ? String(Number(original.sharesOutstandingManual) / 1e9)
        : "",
    ),
    [unit, setUnit] = useState("billions"),
    [fundamentals, setFundamentals] = useState<{
      shares: number | null;
      source: string;
      fetchedAt?: string;
    } | null>(
      original?.sharesOutstandingLive
        ? {
            shares: Number(original.sharesOutstandingLive),
            source:
              mode === "demo"
                ? "Illustrative sample fundamentals"
                : "Saved reference data",
          }
        : null,
    ),
    [fetching, setFetching] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [cleared, setCleared] = useState(false);
  useEffect(() => {
    if (kind !== "MARKET_CAP" || manual || fundamentals) return;
    const controller = new AbortController();
    setFetching(true);
    void api<{ shares: number | null; source: string; fetchedAt?: string }>(
      `/api/fundamentals?symbol=${encodeURIComponent(symbol)}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(setFundamentals)
      .catch((e) => {
        if (e.name !== "AbortError")
          setFundamentals({ shares: null, source: "Unavailable" });
      })
      .finally(() => {
        if (!controller.signal.aborted) setFetching(false);
      });
    return () => controller.abort();
  }, [kind, manual, fundamentals, symbol]);
  const multiplier = unit === "billions" ? 1e9 : unit === "millions" ? 1e6 : 1,
    effective = manual
      ? Number(shares) * multiplier
      : (fundamentals?.shares ?? 0),
    value = kind === "PRICE" ? price : cap,
    derived =
      kind === "PRICE"
        ? price === ""
          ? null
          : Number(price)
        : cap !== "" && effective > 0
          ? (Number(cap) * 1e9) / effective
          : null;
  const asset = assetFromHolding(holding),
    model = derived == null ? null : valueAt({ ...asset, target: derived }, 1),
    intrinsic =
      derived == null
        ? null
        : valueAt({ ...asset, target: derived }, 1, "intrinsic"),
    spot = asset.spot;
  const payload = () =>
    kind === "PRICE"
      ? { targetMode: kind, targetPrice: Number(price) }
      : {
          targetMode: kind,
          targetMarketCap: Number(cap) * 1e9,
          useManualShares: manual,
          ...(manual ? { sharesOutstandingManual: effective } : {}),
        };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/positions/${holding.id}/target`, "PATCH", payload());
      saved(`${symbol} target saved`);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/positions/${holding.id}/target`, "DELETE");
      setCleared(true);
      saved(`${symbol} target cleared`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!original) return;
    setBusy(true);
    try {
      await api(
        `/api/positions/${holding.id}/target`,
        "PATCH",
        original.targetMode === "PRICE"
          ? { targetMode: "PRICE", targetPrice: Number(original.targetPrice) }
          : {
              targetMode: "MARKET_CAP",
              targetMarketCap: Number(original.targetMarketCap),
              useManualShares: original.useManualShares,
              ...(original.useManualShares
                ? {
                    sharesOutstandingManual: Number(
                      original.sharesOutstandingManual,
                    ),
                  }
                : {}),
            },
      );
      setCleared(false);
      saved(`${symbol} target restored`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DeskModal
      title={`${symbol} target scenario`}
      kicker="Make your conviction measurable"
      close={close}
      busy={busy}
    >
      <form onSubmit={save} className="modal-body target-form">
        <div className="target-current">
          <span className="symbol-avatar">
            <Target size={24} />
          </span>
          <div>
            <strong>
              {symbol}
              {holding.optionDetails
                ? ` ${holding.optionDetails.right.toLowerCase()}`
                : ""}
            </strong>
            <small>
              {num(holding.quantity)}{" "}
              {holding.optionDetails ? "contracts" : "shares"} ·{" "}
              {money(holding.projection.currentMarketValue)} current value
            </small>
          </div>
          {spot != null && (
            <span className="current-share">
              <small>Underlying</small>
              <strong>{money(spot)}</strong>
            </span>
          )}
        </div>
        <Segmented
          label="Target type"
          value={kind}
          options={[
            { value: "PRICE", label: "Share price" },
            ...(!knownEtf
              ? [{ value: "MARKET_CAP" as const, label: "Company valuation" }]
              : []),
          ]}
          onChange={setKind}
        />
        {knownEtf && (
          <p className="fine-print">
            This is an ETF. Use a share-price target; company market-cap targets
            do not apply.
          </p>
        )}
        <label>
          {kind === "PRICE"
            ? "Target share price ($)"
            : "Target market cap ($ billions)"}
          <input
            autoFocus
            required
            type="number"
            min={kind === "PRICE" ? 0 : 0.000001}
            step="any"
            value={value}
            onChange={(e) =>
              kind === "PRICE"
                ? setPrice(e.target.value)
                : setCap(e.target.value)
            }
            placeholder={
              kind === "PRICE" ? "Enter your target" : "Enter company valuation"
            }
          />
        </label>
        {kind === "PRICE" && spot != null && (
          <div
            className="target-presets"
            role="group"
            aria-label="Target price presets"
          >
            {[-0.25, 0.1, 0.25, 0.5, 1].map((delta) => (
              <button
                type="button"
                key={delta}
                onClick={() => setPrice((spot * (1 + delta)).toFixed(2))}
              >
                {delta > 0 ? "+" : ""}
                {delta * 100}%
              </button>
            ))}
          </div>
        )}
        {kind === "MARKET_CAP" && (
          <>
            <div className="fundamentals-context">
              <small>Shares outstanding</small>
              <strong>
                {manual
                  ? num(effective)
                  : fetching
                    ? "Loading reference data…"
                    : fundamentals?.shares
                      ? num(fundamentals.shares)
                      : "Manual share count needed"}
              </strong>
              <small>
                {manual ? "Your manual assumption" : fundamentals?.source}
                {fundamentals?.fetchedAt && !manual
                  ? ` · fetched ${new Date(fundamentals.fetchedAt).toLocaleString()}`
                  : ""}
              </small>
            </div>
            <label className="check-label">
              <input
                type="checkbox"
                checked={manual}
                onChange={(e) => setManual(e.target.checked)}
              />
              Override shares outstanding manually
            </label>
            {manual && (
              <div className="two-column">
                <label>
                  Shares outstanding
                  <input
                    type="number"
                    required
                    min={0.000001}
                    step="any"
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                    placeholder="1.35"
                  />
                </label>
                <label>
                  Units
                  <select
                    value={unit}
                    onChange={(e) => {
                      const old = effective,
                        next = e.target.value;
                      setUnit(next);
                      setShares(
                        shares === ""
                          ? ""
                          : String(
                              old /
                                (next === "billions"
                                  ? 1e9
                                  : next === "millions"
                                    ? 1e6
                                    : 1),
                            ),
                      );
                    }}
                  >
                    <option value="billions">Billions of shares</option>
                    <option value="millions">Millions of shares</option>
                    <option value="shares">Total shares</option>
                  </select>
                </label>
              </div>
            )}
            <p className="fine-print">
              Implied price = company valuation ÷ shares outstanding. Company
              valuation is not appropriate for ETFs.
            </p>
          </>
        )}
        {derived != null && Number.isFinite(derived) && derived >= 0 && (
          <div className="target-impact">
            <span className="eyebrow">YOUR THESIS, IN NUMBERS</span>
            <div className="scenario-preview">
              <span>Implied underlying price</span>
              <strong>{money(derived)}</strong>
              {spot != null && spot > 0 && (
                <>
                  <span>Change from current underlying</span>
                  <strong className={derived >= spot ? "positive" : "negative"}>
                    {((derived / spot - 1) * 100).toFixed(1)}%
                  </strong>
                </>
              )}
              <span>
                {holding.optionDetails
                  ? "Model holding value"
                  : "Holding at target"}
              </span>
              <strong>{money(model)}</strong>
              {holding.optionDetails && (
                <>
                  <span>Intrinsic holding value</span>
                  <strong>{money(intrinsic)}</strong>
                </>
              )}
              <span>Change in portfolio value</span>
              <strong>
                {money((model ?? 0) - holding.projection.currentMarketValue)}
              </strong>
            </div>
          </div>
        )}
        <details className="disclosure">
          <summary>What this target assumes</summary>
          <p>
            Targets happen simultaneously. Untargeted holdings retain current
            value.{" "}
            {holding.optionDetails
              ? `Options use remaining time, ${holding.projection.ivEstimated ? "assumed" : "provider"} IV of ${((holding.projection.impliedVolatility ?? 0.6) * 100).toFixed(0)}%, 4% interest, and zero dividends. Expiration uses target intrinsic value. `
              : ""}
            Explore different model assumptions in a saved scenario.
          </p>
        </details>
        {cleared && (
          <div className="info-box" role="status">
            <Check size={16} />
            Target cleared. This holding now retains current value.
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={restore}
            >
              <RotateCcw size={14} />
              Undo clear
            </button>
          </div>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-actions">
          {original && !cleared && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={clear}
            >
              Clear target
            </button>
          )}
          <button
            className="button primary"
            disabled={busy || derived == null || !Number.isFinite(derived)}
          >
            {busy ? "Saving…" : "Save target"}
            <ArrowRight size={17} />
          </button>
        </footer>
      </form>
    </DeskModal>
  );
}
