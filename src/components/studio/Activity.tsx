"use client";
import { useMemo, useState } from "react";
import {
  Download,
  ArrowDownLeft,
  ArrowUpRight,
  ReceiptText,
} from "lucide-react";
import { type Portfolio, money } from "@/lib/desk-types";
import { csvCell, downloadText } from "@/lib/studio";
import { DeskModal } from "@/components/DeskModal";
export function Activity({ portfolios }: { portfolios: Portfolio[] }) {
  const [type, setType] = useState("ALL"),
    [search, setSearch] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [receipt, setReceipt] = useState<string | null>(null);
  const all = useMemo(
    () =>
      portfolios
        .flatMap((p) => p.ledger.map((l) => ({ ...l, portfolio: p.name })))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [portfolios],
  );
  const events = all.filter(
    (e) =>
      (type === "ALL" || e.type === type) &&
      `${e.note} ${e.portfolio}`.toLowerCase().includes(search.toLowerCase()) &&
      (!from || e.createdAt.slice(0, 10) >= from) &&
      (!to || e.createdAt.slice(0, 10) <= to),
  );
  const labels: Record<string, string> = {
    DEPOSIT: "Virtual cash added",
    WITHDRAWAL: "Virtual cash removed",
    BUY: "Simulated purchase",
    SELL: "Simulated sale",
  };
  const selected = all.find((e) => e.id === receipt);
  return (
    <div className="activity-view">
      <div className="activity-filters">
        <label>
          Activity
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="ALL">All transactions</option>
            {Object.entries(labels).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Details or portfolio"
          />
        </label>
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <div className="activity-summary">
        <span>{events.length} recent transactions</span>
        <button
          className="text-button"
          onClick={() => {
            setType("ALL");
            setSearch("");
            setFrom("");
            setTo("");
          }}
        >
          Reset filters
        </button>
        <button
          className="text-button"
          disabled={!events.length}
          onClick={() =>
            downloadText(
              [
                ["Transaction", "Portfolio", "Details", "Date", "Cash impact"],
                ...events.map((e) => [
                  labels[e.type] ?? e.type,
                  e.portfolio,
                  e.note,
                  e.createdAt,
                  e.amount,
                ]),
              ]
                .map((r) => r.map(csvCell).join(","))
                .join("\r\n"),
              "investor-desk-activity.csv",
              "text/csv",
            )
          }
        >
          <Download size={15} />
          Export this view
        </button>
      </div>
      {!events.length ? (
        <div className="empty-state">
          <span>
            <ReceiptText size={28} />
          </span>
          <h3>
            {all.length
              ? "No matching transactions."
              : "Your story starts with a first move."}
          </h3>
          <p>Deposits, withdrawals, and simulated trades appear here.</p>
        </div>
      ) : (
        <div className="activity-list">
          {events.map((e, i) => (
            <div key={e.id}>
              {(i === 0 ||
                e.createdAt.slice(0, 10) !==
                  events[i - 1].createdAt.slice(0, 10)) && (
                <h4>
                  {new Date(e.createdAt).toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </h4>
              )}
              <button className="activity-row" onClick={() => setReceipt(e.id)}>
                <span
                  className={`transaction-icon ${Number(e.amount) >= 0 ? "positive" : "negative"}`}
                >
                  {Number(e.amount) >= 0 ? (
                    <ArrowDownLeft size={18} />
                  ) : (
                    <ArrowUpRight size={18} />
                  )}
                </span>
                <span>
                  <strong>{labels[e.type] ?? e.type}</strong>
                  <small>
                    {e.note || e.portfolio} · {e.portfolio}
                  </small>
                </span>
                <strong
                  className={Number(e.amount) >= 0 ? "positive" : "negative"}
                >
                  {Number(e.amount) > 0 ? "+" : ""}
                  {money(Number(e.amount))}
                  <small>
                    {new Date(e.createdAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                </strong>
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="table-footnote">
        Recent entries loaded with this workspace. This ledger is not a complete
        performance or tax report.
      </p>
      {selected && (
        <DeskModal
          title={labels[selected.type] ?? selected.type}
          kicker="Transaction receipt"
          close={() => setReceipt(null)}
        >
          <div className="modal-body">
            <div className="receipt-value">
              {money(Number(selected.amount))}
            </div>
            <dl className="detail-list">
              <div>
                <dt>Portfolio</dt>
                <dd>{selected.portfolio}</dd>
              </div>
              <div>
                <dt>Details</dt>
                <dd>{selected.note || "Cash adjustment"}</dd>
              </div>
              <div>
                <dt>Recorded</dt>
                <dd>{new Date(selected.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd className="break-all">{selected.id}</dd>
              </div>
            </dl>
            <p className="fine-print">
              A simulated transaction. No money moved through a brokerage.
            </p>
          </div>
        </DeskModal>
      )}
    </div>
  );
}
