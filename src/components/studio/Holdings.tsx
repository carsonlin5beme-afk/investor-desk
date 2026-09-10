"use client";
import { useState } from "react";
import {
  ArrowDownUp,
  ArrowUpRight,
  Target,
  ArrowRight,
  Layers,
} from "lucide-react";
import { type Holding, type Portfolio, money, num } from "@/lib/desk-types";
export function Holdings({
  holdings,
  portfolios,
  totalCount,
  onTarget,
  onSell,
  onDetail,
  onClear,
  onTrade,
}: {
  holdings: Holding[];
  portfolios: Portfolio[];
  totalCount: number;
  onTarget: (h: Holding) => void;
  onSell: (h: Holding) => void;
  onDetail: (h: Holding) => void;
  onClear: () => void;
  onTrade: () => void;
}) {
  const [sort, setSort] = useState<{ key: string; direction: 1 | -1 }>({
    key: "symbol",
    direction: 1,
  });
  const val = (h: Holding, key: string): string | number =>
    key === "symbol"
      ? (h.optionDetails?.underlying ?? h.symbol)
      : key === "quantity"
        ? h.quantity
        : key === "current"
          ? h.projection.currentMarketValue
          : key === "pnl"
            ? h.projection.unrealizedPnL
            : key === "target"
              ? (h.projection.targetUnderlyingPrice ?? -1)
              : h.projection.projectedValue;
  const rows = [...holdings].sort((a, b) => {
    const x = val(a, sort.key),
      y = val(b, sort.key);
    return (
      (typeof x === "string" && typeof y === "string"
        ? x.localeCompare(y)
        : Number(x) - Number(y)) * sort.direction
    );
  });
  const total = holdings.reduce(
    (s, h) => ({
      current: s.current + h.projection.currentMarketValue,
      target: s.target + h.projection.projectedValue,
      pnl: s.pnl + h.projection.unrealizedPnL,
    }),
    { current: 0, target: 0, pnl: 0 },
  );
  if (!holdings.length)
    return (
      <div className="empty-state">
        <span>
          <Layers size={27} />
        </span>
        <h3>
          {totalCount
            ? "No holdings match this view."
            : "Make room for your first idea."}
        </h3>
        <p>
          {totalCount
            ? "Try another symbol or reset the filters."
            : "Choose a stock, ETF, or option to begin building your portfolio."}
        </p>
        <button
          className="button secondary"
          onClick={totalCount ? onClear : onTrade}
        >
          {totalCount ? "Clear filters" : "Add your first holding"}
          <ArrowRight size={16} />
        </button>
      </div>
    );
  return (
    <div className="table-scroll">
      <table className="holdings-table">
        <caption className="sr-only">
          {holdings.length} of {totalCount} holdings. Totals reflect visible
          rows.
        </caption>
        <thead>
          <tr>
            {[
              ["symbol", "Holding"],
              ["quantity", "Quantity / cost"],
              ["current", "Current value"],
              ["pnl", "Unrealized P/L"],
              ["target", "Underlying target"],
              ["projected", "At target"],
            ].map(([key, label]) => (
              <th
                key={key}
                aria-sort={
                  sort.key === key
                    ? sort.direction === 1
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  className="sort-button"
                  onClick={() =>
                    setSort((old) => ({
                      key,
                      direction:
                        old.key === key && old.direction === 1 ? -1 : 1,
                    }))
                  }
                >
                  {label}
                  <ArrowDownUp size={12} />
                </button>
              </th>
            ))}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => {
            const p = h.projection,
              symbol = h.optionDetails?.underlying ?? h.symbol,
              name = portfolios.find((v) => v.id === h.portfolioId)?.name;
            return (
              <tr key={h.id}>
                <td data-label="Holding">
                  <button
                    className="holding-name"
                    onClick={() => onDetail(h)}
                    aria-label={`Open ${symbol} ${h.optionDetails ? `${h.optionDetails.right} ${h.optionDetails.strike}` : "holding"} in ${name}`}
                  >
                    <span
                      className={`symbol-avatar ${h.optionDetails ? "option-avatar" : ""}`}
                    >
                      {symbol.slice(0, 2)}
                    </span>
                    <span>
                      <strong>
                        {symbol}
                        <span className="asset-label">
                          {h.optionDetails
                            ? h.optionDetails.right
                            : "STOCK / ETF"}
                        </span>
                      </strong>
                      <small>
                        {h.optionDetails
                          ? `${money(Number(h.optionDetails.strike))} · ${h.optionDetails.expiration.slice(0, 10)}`
                          : name}
                      </small>
                      <small
                        className={
                          p.quoteStale || p.priceEstimated ? "warning-text" : ""
                        }
                      >
                        {p.priceEstimated
                          ? "Cost-basis estimate"
                          : p.quoteSource === "demo"
                            ? "Sample quote"
                            : p.quoteStale
                              ? "Stale quote"
                              : p.quoteSource}
                        {p.expired ? " · expired" : ""}
                      </small>
                    </span>
                  </button>
                </td>
                <td data-label="Quantity / cost">
                  <strong>
                    {num(h.quantity)} {h.optionDetails ? "ct" : "sh"}
                  </strong>
                  <small>{money(h.avgCost)} avg</small>
                </td>
                <td data-label="Current value">
                  <strong>{money(p.currentMarketValue)}</strong>
                  <small>
                    {money(p.currentPrice)}{" "}
                    {h.optionDetails ? "premium" : "per share"}
                  </small>
                </td>
                <td data-label="Unrealized P/L">
                  <strong
                    className={p.unrealizedPnL >= 0 ? "positive" : "negative"}
                  >
                    {p.unrealizedPnL > 0 ? "+" : ""}
                    {money(p.unrealizedPnL)}
                  </strong>
                  <small>
                    {p.costBasis
                      ? ((p.unrealizedPnL / p.costBasis) * 100).toFixed(2)
                      : "0"}
                    %
                  </small>
                </td>
                <td data-label="Underlying target">
                  <button
                    className={`target-button ${p.hasTarget ? "has-target" : ""}`}
                    onClick={() => onTarget(h)}
                    aria-label={`${p.hasTarget ? "Edit" : "Set"} ${symbol} target${p.hasTarget ? `: ${money(p.targetUnderlyingPrice)}` : ""}`}
                  >
                    <Target size={14} />
                    {p.hasTarget
                      ? money(p.targetUnderlyingPrice)
                      : "Set target"}
                  </button>
                </td>
                <td data-label="At target">
                  <strong className="projected-cell">
                    {money(p.projectedValue)}
                  </strong>
                  <small>
                    {p.hasTarget
                      ? h.optionDetails
                        ? `${money(p.optionIntrinsicProjectedValue)} intrinsic`
                        : "At your target"
                      : "Current value · no target"}
                  </small>
                </td>
                <td data-label="Actions">
                  <button
                    className="text-button"
                    onClick={() => onSell(h)}
                    aria-label={`Sell ${symbol} ${h.optionDetails?.right ?? "shares"} in ${name}`}
                  >
                    Sell
                    <ArrowUpRight size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>
              Visible holdings · {holdings.length} of {totalCount}
            </td>
            <td>{money(total.current)}</td>
            <td>{money(total.pnl)}</td>
            <td>Cash shown separately</td>
            <td>{money(total.target)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
