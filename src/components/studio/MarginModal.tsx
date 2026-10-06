"use client";
import { useState } from "react";
import { DeskModal } from "@/components/DeskModal";
import { api, money, type Portfolio } from "@/lib/desk-types";
import {
  marginSettingsSchema,
  resolveMarginSettings,
  summarizeMargin,
  type MarginSettings,
} from "@/lib/margin";
import styles from "./margin.module.css";
export function MarginModal({
  portfolio,
  close,
  saved,
}: {
  portfolio: Portfolio;
  close: () => void;
  saved: (settings: MarginSettings) => void;
}) {
  const initial = resolveMarginSettings(portfolio.margin);
  const [debt, setDebt] = useState(String(initial.debt));
  const [apr, setApr] = useState(
    initial.debt === 0 && initial.aprPercent === 0
      ? ""
      : String(initial.aprPercent),
  );
  const [maintenance, setMaintenance] = useState(
    String(initial.maintenancePercent),
  );
  const [basis, setBasis] = useState<360 | 365>(initial.dayCountBasis);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const parsed = marginSettingsSchema.safeParse({
    debt: debt.trim() ? Number(debt) : NaN,
    aprPercent: apr.trim() ? Number(apr) : NaN,
    maintenancePercent: maintenance.trim() ? Number(maintenance) : NaN,
    dayCountBasis: basis,
  });
  const summary = parsed.success
    ? summarizeMargin(
        portfolio.cashBalance,
        portfolio.equitiesValue,
        portfolio.optionsValue,
        parsed.data,
      )
    : null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed.success || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ margin: MarginSettings }>(
        `/api/portfolios/${portfolio.id}/margin`,
        "PATCH",
        parsed.data,
      );
      saved(marginSettingsSchema.parse(result.margin));
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DeskModal
      title="Manage margin"
      kicker={portfolio.name}
      close={close}
      busy={busy}
    >
      <form className={`modal-body ${styles.editor}`} onSubmit={submit}>
        <p className="muted">
          Enter an existing liability for this simulated portfolio. These
          settings leave available cash and trade limits unchanged.
        </p>
        <div className={styles.fields}>
          <label>
            Existing margin debt ($)
            <input
              autoFocus
              required
              type="number"
              min="0"
              max="1000000000000"
              step="0.01"
              value={debt}
              disabled={busy}
              onChange={(e) => setDebt(e.target.value)}
            />
          </label>
          <label>
            Margin loan APR (%)
            <input
              required
              type="number"
              min="0"
              step="any"
              value={apr}
              disabled={busy}
              placeholder="Enter your APR, including 0"
              onChange={(e) => setApr(e.target.value)}
            />
          </label>
          <label>
            Equity maintenance (%)
            <input
              required
              type="number"
              min="25"
              max="100"
              step="any"
              value={maintenance}
              disabled={busy}
              onChange={(e) => setMaintenance(e.target.value)}
            />
          </label>
          <label>
            Interest day-count basis
            <select
              value={basis}
              disabled={busy}
              onChange={(e) => setBasis(Number(e.target.value) as 360 | 365)}
            >
              <option value={360}>360 days</option>
              <option value={365}>365 days</option>
            </select>
          </label>
        </div>
        {!parsed.success && (
          <p className="fine-print">
            Enter whole-cent debt, a nonnegative APR, and maintenance from 25%
            to 100%.
          </p>
        )}
        <dl className={styles.values} aria-label="Margin preview">
          {[
            [
              "Gross assets",
              portfolio.cashBalance +
                portfolio.equitiesValue +
                portfolio.optionsValue,
            ],
            ["Entered debt", parsed.success ? parsed.data.debt : null],
            ["Net equity", summary?.netEquity],
            ["Available cash", portfolio.cashBalance],
            ["Margin equity", summary?.marginEquity],
            ["Maintenance required", summary?.maintenanceRequired],
            ["Maintenance excess", summary?.maintenanceExcess],
            ["Maintenance shortfall", summary?.maintenanceShortfall],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <dt>{String(label)}</dt>
              <dd className="private-value">
                {money(value as number | null | undefined)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="fine-print">
          This conservative estimate assumes all equity holdings are eligible
          and excludes standalone long options from collateral. The default 25%
          is editable; this is not a broker’s margin determination.
        </p>
        <p className="fine-print">
          Current debt is the amount you enter. Monthly scenarios estimate daily
          compounding using your APR, {basis}-day basis, and whole Eastern
          calendar days, including weekends. Option model interest remains a
          separate assumption. Captured rates stay fixed; there is no cash
          netting or automatic paydown.
        </p>
        {summary && summary.maintenanceShortfall > 0 && (
          <p className="error-box" role="status">
            Modeled maintenance shortfall:{" "}
            <span className="private-value">
              {money(summary.maintenanceShortfall)}
            </span>
            . Saving does not liquidate holdings or fund the account.
          </p>
        )}
        {error && (
          <p className="error-box" role="alert">
            {error}
          </p>
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
          <button className="button primary" disabled={busy || !parsed.success}>
            {busy ? "Saving…" : "Save margin settings"}
          </button>
        </footer>
      </form>
    </DeskModal>
  );
}
