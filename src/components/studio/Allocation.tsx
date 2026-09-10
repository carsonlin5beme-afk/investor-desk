"use client";
import { useState } from "react";
import { type Holding, money } from "@/lib/desk-types";
import { Segmented } from "./Controls";
export function Allocation({
  holdings,
  cash,
  filter,
  onFilter,
}: {
  holdings: Holding[];
  cash: number;
  filter: string;
  onFilter: (value: string) => void;
}) {
  const [basis, setBasis] = useState<"current" | "target">("current"),
    [view, setView] = useState<"assets" | "companies">("assets");
  const value = (h: Holding) =>
    basis === "current"
      ? h.projection.currentMarketValue
      : h.projection.projectedValue;
  const groups =
    view === "assets"
      ? [
          {
            id: "EQUITY",
            name: "Equities / ETFs",
            value: holdings
              .filter((h) => h.assetClass === "EQUITY")
              .reduce((s, h) => s + value(h), 0),
            color: "var(--green)",
          },
          {
            id: "OPTION",
            name: "Options",
            value: holdings
              .filter((h) => h.assetClass === "OPTION")
              .reduce((s, h) => s + value(h), 0),
            color: "var(--copper)",
          },
          { id: "CASH", name: "Cash", value: cash, color: "var(--cash)" },
        ]
      : Object.entries(
          holdings.reduce<Record<string, number>>((a, h) => {
            const key = h.optionDetails?.underlying ?? h.symbol;
            a[key] = (a[key] ?? 0) + value(h);
            return a;
          }, {}),
        )
          .sort((a, b) => b[1] - a[1])
          .map(([name, v], i) => ({
            id: `SYMBOL:${name}`,
            name,
            value: v,
            color: [
              "var(--green)",
              "var(--copper)",
              "var(--blue)",
              "var(--purple)",
              "var(--cash)",
            ][i % 5],
          }))
          .concat([
            { id: "CASH", name: "Cash", value: cash, color: "var(--cash)" },
          ]);
  const total = groups.reduce((s, g) => s + g.value, 0),
    r = 71,
    circumference = 2 * Math.PI * r;
  let offset = 0;
  const invested = total ? Math.round(((total - cash) / total) * 100) : 0;
  return (
    <section className="panel allocation-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">A balanced perspective</span>
          <h2>Capital allocation</h2>
        </div>
      </div>
      <Segmented
        label="Allocation basis"
        value={basis}
        options={[
          { value: "current", label: "Current" },
          { value: "target", label: "At targets" },
        ]}
        onChange={setBasis}
      />
      <div className="allocation-visual">
        <svg
          width="190"
          height="190"
          viewBox="0 0 190 190"
          role="img"
          aria-label={`${invested}% invested. ${groups.map((g) => `${g.name}: ${money(g.value)}`).join(". ")}`}
        >
          <circle
            cx={95}
            cy={95}
            r={r}
            fill="none"
            stroke="var(--line)"
            strokeWidth={20}
          />
          {groups.map((g) => {
            const length = total ? (g.value / total) * circumference : 0,
              start = offset;
            offset += length;
            return (
              <circle
                key={g.id}
                cx={95}
                cy={95}
                r={r}
                fill="none"
                stroke={g.color}
                strokeWidth={filter === g.id ? 26 : 20}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={-start}
                transform="rotate(-90 95 95)"
                className="allocation-segment"
                onClick={() => onFilter(filter === g.id ? "ALL" : g.id)}
              />
            );
          })}
          <text x={95} y={89} textAnchor="middle" className="ring-label">
            INVESTED
          </text>
          <text x={95} y={120} textAnchor="middle" className="ring-total">
            {invested}%
          </text>
        </svg>
      </div>
      <div className="allocation-legend">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            aria-pressed={filter === g.id}
            onClick={() => onFilter(filter === g.id ? "ALL" : g.id)}
          >
            <i style={{ background: g.color }} />
            <span>
              {g.name}
              <small>{total ? ((g.value / total) * 100).toFixed(1) : 0}%</small>
            </span>
            <strong>{money(g.value, 0)}</strong>
          </button>
        ))}
      </div>
      <div className="allocation-footer">
        <button
          className="text-button"
          onClick={() => {
            setView((v) => (v === "assets" ? "companies" : "assets"));
            onFilter("ALL");
          }}
        >
          {view === "assets"
            ? "View underlying concentration"
            : "View asset classes"}
        </button>
        {filter !== "ALL" && (
          <button className="text-button" onClick={() => onFilter("ALL")}>
            Clear filter
          </button>
        )}
      </div>
      <p className="fine-print">
        {basis === "target" ? "Hypothetical weights at model targets. " : ""}
        {view === "companies"
          ? "Concentration by market value, combining stock and options on each underlying. This is not delta exposure."
          : "Select a segment or legend row to explore its holdings."}
      </p>
    </section>
  );
}
