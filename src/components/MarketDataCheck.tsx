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
    <section aria-label="Market data connection checks">
      <button className="button secondary" disabled={busy} onClick={check}>
        {busy ? "Checking feed access..." : "Test feed access (read-only)"}
      </button>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {result && (
        <div aria-live="polite">
          {result.equityFeedConfigured !== "sip" && (
            <p className="info-box">
              Stocks are configured for IEX only. Select ALPACA_FEED=sip for
              consolidated quotes, after verifying entitlement.
            </p>
          )}
          {result.checks.map((c) => (
            <div className="info-box" key={c.name}>
              <strong>
                {c.name}: {c.status.replaceAll("_", " ")}
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
