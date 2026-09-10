"use client";
import { useMemo, useState } from "react";
import { money } from "@/lib/desk-types";
import { blackScholesPrice } from "@/server/domain/black-scholes";
import { ValueChart } from "./ValueChart";
export function OptionsExplorer({
  spot,
  strike,
  right,
  expiration,
  premium,
  iv = 0.6,
  quantity = 1,
  multiplier = 100,
}: {
  spot: number;
  strike: number;
  right: "CALL" | "PUT";
  expiration: string;
  premium: number;
  iv?: number;
  quantity?: number;
  multiplier?: number;
}) {
  const [vol, setVol] = useState(Math.max(0.01, Math.round(iv * 10000) / 100)),
    [days, setDays] = useState(0),
    [cell, setCell] = useState<{
      price: number;
      iv: number;
    } | null>(null);
  const valuationAt = useMemo(
    () => Date.now(),
    [expiration, spot, strike, premium],
  );
  const remaining = Math.max(
      0,
      (new Date(expiration).getTime() - valuationAt) / 86400000 - days,
    ),
    min = 0,
    max = Math.max(spot, strike, 1) * 2;
  const payoff = (price: number) =>
    ((right === "CALL"
      ? Math.max(0, price - strike)
      : Math.max(0, strike - price)) -
      premium) *
    quantity *
    multiplier;
  const model = (price: number, volatility: number) =>
    (blackScholesPrice({
      spot: price,
      strike,
      timeToExpiryYears: remaining / 365,
      riskFreeRate: 0.04,
      volatility: volatility / 100,
      isCall: right === "CALL",
    }) -
      premium) *
    quantity *
    multiplier;
  const prices = [0.5, 0.75, 1, 1.25, 1.5].map((v) => v * spot),
    volStep = Math.min(10, vol * 0.4),
    vols = [-2, -1, 0, 1, 2].map((offset) =>
      Number((vol + offset * volStep).toFixed(4)),
    );
  const series = useMemo(
    () => [
      {
        id: "payoff",
        name: "At expiration",
        color: "var(--green)",
        valueAt: (p: number) => payoff(min + (max - min) * p),
        values: Array.from({ length: 81 }, (_, i) =>
          payoff(min + ((max - min) * i) / 80),
        ),
      },
      {
        id: "model",
        name: `Model · ${Math.round(remaining)} days left`,
        color: "var(--copper)",
        valueAt: (p: number) => model(min + (max - min) * p, vol),
        values: Array.from({ length: 81 }, (_, i) =>
          model(min + ((max - min) * i) / 80, vol),
        ),
      },
    ],
    [
      spot,
      strike,
      right,
      expiration,
      premium,
      quantity,
      multiplier,
      vol,
      days,
      valuationAt,
    ],
  );
  return (
    <div className="options-explorer">
      <div className="option-risk-metrics">
        <div>
          <span>Expiration break-even</span>
          <strong>
            {money(strike + (right === "CALL" ? premium : -premium))}
          </strong>
        </div>
        <div>
          <span>Premium at risk</span>
          <strong>{money(premium * quantity * multiplier)}</strong>
        </div>
      </div>
      <ValueChart
        label="Option profit and loss by underlying price"
        xLabel="Underlying price (USD)"
        xMax={max}
        xUnit="usd"
        yLabel="Profit / loss · USD"
        series={series}
        reference={0}
      />
      <div className="two-column">
        <label>
          Model volatility: {vol}%
          <input
            type="range"
            min={0.01}
            step={0.01}
            max={Math.max(200, Math.ceil(iv * 100))}
            value={vol}
            onChange={(e) => setVol(Number(e.target.value))}
          />
        </label>
        <label>
          Days forward: {days}
          <input
            type="range"
            min={0}
            max={Math.max(
              1,
              Math.ceil(
                (new Date(expiration).getTime() - valuationAt) / 86400000,
              ),
            )}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </label>
      </div>
      <details className="disclosure">
        <summary>Price / volatility sensitivity</summary>
        <div className="table-scroll">
          <table className="sensitivity-table">
            <caption>Modeled P/L · select a cell for exact value</caption>
            <thead>
              <tr>
                <th>IV / price</th>
                {prices.map((p) => (
                  <th key={p}>{money(p)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vols.map((v, index) => (
                <tr key={index}>
                  <th>{v}%</th>
                  {prices.map((p, i) => {
                    const val = model(p, v);
                    return (
                      <td key={i}>
                        <button
                          type="button"
                          className={
                            val >= 0
                              ? "sensitivity-positive"
                              : "sensitivity-negative"
                          }
                          onClick={() => setCell({ price: p, iv: v })}
                          aria-pressed={cell?.price === p && cell?.iv === v}
                          aria-label={`At ${money(p)} and ${v}% IV: ${money(val)} modeled profit or loss`}
                        >
                          {money(val, 0)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {cell && (
          <p role="status">
            At {money(cell.price)} and {cell.iv}% IV:{" "}
            <strong>{money(model(cell.price, cell.iv))}</strong> modeled P/L.
          </p>
        )}
      </details>
      <p className="fine-print">
        P/L includes the entry premium. Model uses 4% interest, zero dividends,
        and a European exercise approximation. Model changes here are
        exploratory and do not edit an order or holding target.
      </p>
    </div>
  );
}
