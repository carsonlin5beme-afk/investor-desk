"use client";
import { useState } from "react";
import { Target, ArrowRight } from "lucide-react";
import { api, Holding, money, num } from "@/lib/desk-types";
import { DeskModal } from "./DeskModal";
export function TargetEditor({
  holding,
  mode,
  close,
  saved,
}: {
  holding: Holding;
  mode: string;
  close: () => void;
  saved: () => void;
}) {
  const s = holding.targetScenario;
  const [kind, setKind] = useState(s?.targetMode ?? "PRICE"),
    [value, setValue] = useState(
      s?.targetMode === "MARKET_CAP"
        ? String(Number(s.targetMarketCap) / 1e9)
        : (s?.targetPrice ?? ""),
    ),
    [manual, setManual] = useState(s?.useManualShares ?? false),
    [shares, setShares] = useState(s?.sharesOutstandingManual ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const symbol = holding.optionDetails?.underlying ?? holding.symbol;
  const effective = manual ? Number(shares) : Number(s?.sharesOutstandingLive);
  const derived =
    kind === "PRICE"
      ? Number(value)
      : effective > 0
        ? (Number(value) * 1e9) / effective
        : null;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/positions/${holding.id}/target`, "PATCH", {
        targetMode: kind,
        ...(kind === "PRICE"
          ? { targetPrice: Number(value) }
          : {
              targetMarketCap: Number(value) * 1e9,
              useManualShares: manual,
              ...(manual ? { sharesOutstandingManual: Number(shares) } : {}),
            }),
      });
      saved();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    setBusy(true);
    try {
      await api(`/api/positions/${holding.id}/target`, "DELETE");
      saved();
      close();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <DeskModal
      title={`${symbol} target scenario`}
      kicker="Make your thesis measurable"
      close={close}
      busy={busy}
    >
      <form onSubmit={save} className="modal-body">
        <div className="target-current">
          <span className="symbol-avatar">
            <Target />
          </span>
          <div>
            <strong>{symbol}</strong>
            <small>
              {num(holding.quantity)}{" "}
              {holding.assetClass === "OPTION" ? "contracts" : "shares"} ·{" "}
              {money(holding.projection.currentMarketValue)} current holding
              value
            </small>
          </div>
        </div>
        <div className="segmented">
          <button
            type="button"
            className={kind === "PRICE" ? "active" : ""}
            onClick={() => {
              setKind("PRICE");
              setValue("");
            }}
          >
            Share price
          </button>
          <button
            type="button"
            className={kind === "MARKET_CAP" ? "active" : ""}
            onClick={() => {
              setKind("MARKET_CAP");
              setValue("");
            }}
          >
            Company valuation
          </button>
        </div>
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
            placeholder={kind === "PRICE" ? "2000" : "50"}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {kind === "MARKET_CAP" && (
          <>
            <p className="muted">
              Target share price = company market cap / shares outstanding.
              Company valuation targets are not appropriate for ETFs.
            </p>
            <label className="check-label">
              <input
                type="checkbox"
                checked={manual}
                onChange={(e) => setManual(e.target.checked)}
              />
              Override shares outstanding manually
            </label>
            {manual ? (
              <label>
                Shares outstanding (total shares, not billions)
                <input
                  required
                  min="1"
                  step="any"
                  type="number"
                  value={shares}
                  placeholder="1350000000"
                  onChange={(e) => setShares(e.target.value)}
                />
              </label>
            ) : (
              <div className="info-box">
                {mode === "demo"
                  ? "Sample fundamentals will be used. These are illustrative, not current company figures."
                  : "Fetch the latest available shares outstanding on save. If unavailable, a manual override is required."}
              </div>
            )}
          </>
        )}
        {value !== "" && derived != null && (
          <div className="scenario-preview">
            <span>Implied {symbol} share price</span>
            <strong>{money(derived)}</strong>
            {holding.assetClass === "EQUITY" && (
              <>
                <span>Projected holding value</span>
                <strong>{money(derived * holding.quantity)}</strong>
              </>
            )}
          </div>
        )}
        {holding.optionDetails && (
          <p className="fine-print">
            Options show both target intrinsic value and an estimate using
            current time to expiry and IV. These are hypothetical values, not
            guaranteed sale prices. All portfolio targets are assumed to occur
            together.
          </p>
        )}
        {error && (
          <div role="alert" className="error-box">
            {error}
          </div>
        )}
        <footer className="modal-actions">
          {s && (
            <button
              type="button"
              className="text-button"
              onClick={clear}
              disabled={busy}
            >
              Clear target
            </button>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? "Saving..." : "Save target"}
            <ArrowRight size={17} />
          </button>
        </footer>
      </form>
    </DeskModal>
  );
}
