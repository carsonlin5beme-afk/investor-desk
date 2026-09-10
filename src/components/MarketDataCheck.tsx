"use client";
import { useState } from "react";
import { api } from "@/lib/desk-types";
type Result = {
  checkedAt: string;
  note: string;
  equityFeedConfigured: string;
  checks: { name: string; status: string; detail: string; asOf?: string }[];
};
export function MarketDataCheck() {
  const [result, setResult] = useState<Result | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function check() {
    setBusy(true);
    setError("");
    try {
      setResult(await api<Result>("/api/market-data/check"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="connection-checks"
      aria-label="Market data connection checks"
    >
      <button className="button secondary" disabled={busy} onClick={check}>
        {busy ? "Checking feed access..." : "Check connections"}
      </button>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {result && (
        <div aria-live="polite">
          <p className="fine-print">
            Checked {new Date(result.checkedAt).toLocaleString()}
          </p>
          {result.equityFeedConfigured === "iex" && (
            <p className="info-box">
              Stocks are configured for IEX only. Select ALPACA_FEED=sip for
              consolidated quotes, after verifying entitlement.
            </p>
          )}
          {result.checks.map((c) => (
            <div className="connection-result" key={c.name}>
              <strong>
                {c.name}
                <span className="badge subtle">
                  {c.status.replaceAll("_", " ")}
                </span>
              </strong>
              <p>{c.detail}</p>
              {c.asOf && (
                <small>
                  Quote timestamp: {new Date(c.asOf).toLocaleString()}
                </small>
              )}
            </div>
          ))}
          <p>{result.note}</p>
        </div>
      )}
    </section>
  );
}
