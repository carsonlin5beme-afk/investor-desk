"use client";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { api, type Portfolio, money } from "@/lib/desk-types";
import { DeskModal } from "@/components/DeskModal";
export function CashModal({
  portfolio,
  close,
  saved,
}: {
  portfolio?: Portfolio;
  close: () => void;
  saved: (id?: string) => void;
}) {
  const [name, setName] = useState(""),
    [amount, setAmount] = useState(""),
    [type, setType] = useState("DEPOSIT"),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ portfolio?: { id: string } }>(
        portfolio ? `/api/portfolios/${portfolio.id}/cash` : "/api/portfolios",
        "POST",
        portfolio
          ? { type, amount: Number(amount), note }
          : { name, startingCash: Number(amount) },
      );
      saved(result.portfolio?.id);
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
        {portfolio && amount && Number(amount) > 0 && (
          <div className="scenario-preview">
            <span>
              Balance after {type === "DEPOSIT" ? "addition" : "withdrawal"}
            </span>
            <strong
              className={
                type === "WITHDRAWAL" && Number(amount) > portfolio.cashBalance
                  ? "negative"
                  : ""
              }
            >
              {money(
                portfolio.cashBalance +
                  (type === "DEPOSIT" ? 1 : -1) * Number(amount),
              )}
            </strong>
          </div>
        )}
        <p className="muted">
          Each portfolio has its own cash balance. This is simulated funding,
          not a real transfer.
        </p>
        {portfolio &&
          type === "WITHDRAWAL" &&
          Number(amount) > portfolio.cashBalance && (
            <p className="error-box" role="alert">
              Available virtual cash is {money(portfolio.cashBalance)}. Reduce
              the withdrawal by {money(Number(amount) - portfolio.cashBalance)}.
            </p>
          )}
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
          <button
            className="button primary"
            disabled={
              busy ||
              Boolean(
                portfolio &&
                type === "WITHDRAWAL" &&
                Number(amount) > portfolio.cashBalance,
              )
            }
          >
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
