"use client";
import { useId, useMemo, useState } from "react";
import { money, num } from "@/lib/desk-types";
import { longOptionProfit, parseHypotheticalPrice } from "@/lib/option-profit";
import { blackScholesPrice } from "@/server/domain/black-scholes";
import { ValueChart } from "./ValueChart";
import { resolveOptionExpiry } from "@/lib/option-expiration";
import styles from "./options-explorer.module.css";

const preciseMoney = (value: number, maximumFractionDigits = 6) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(value);

export function OptionsExplorer({
  underlying,
  spot,
  strike,
  right,
  expiration,
  premium,
  iv = 0.6,
  ivEstimated = false,
  quantity = 1,
  multiplier = 100,
}: {
  underlying: string;
  spot?: number | null;
  strike: number;
  right: "CALL" | "PUT";
  expiration: string;
  premium: number;
  iv?: number;
  ivEstimated?: boolean;
  quantity?: number;
  multiplier?: number;
}) {
  const priceId = useId();
  const hasSpot = spot != null && Number.isFinite(spot) && spot >= 0;
  const initialPrice = hasSpot ? spot : strike;
  const initialVol = Number.isFinite(iv) && iv > 0 ? iv : 0.6;
  const [vol, setVol] = useState(
      Math.max(0.01, Math.round(initialVol * 10000) / 100),
    ),
    [days, setDays] = useState(0),
    [hypotheticalPrice, setHypotheticalPrice] = useState(String(initialPrice)),
    [cell, setCell] = useState<{ price: number; iv: number } | null>(null);
  const valuationAt = useMemo(
    () => Date.now(),
    [expiration, spot, strike, premium],
  );
  const expiry = useMemo(() => {
    try {
      return resolveOptionExpiry(expiration, underlying);
    } catch {
      return null;
    }
  }, [expiration, underlying]);
  const remaining = Math.max(
    0,
    (expiry
      ? (expiry.modelExpirationAt.getTime() - valuationAt) / 86400000
      : 0) - days,
  );
  const terms = { right, strike, premium, quantity, multiplier };
  const base = longOptionProfit(terms, strike);
  const min = 0,
    max = Math.max(initialPrice, strike, 1) * 2;
  const validContract = base != null && expiry != null && Number.isFinite(max);
  const payoff = (price: number) =>
    longOptionProfit(terms, price)?.expirationProfit ?? 0;
  const model = (price: number, volatility: number) => {
    if (!base) return null;
    const value =
      (blackScholesPrice({
        spot: price,
        strike,
        timeToExpiryYears: remaining / 365,
        riskFreeRate: 0.04,
        volatility: volatility / 100,
        isCall: right === "CALL",
      }) -
        premium) *
      base.shares;
    return Number.isFinite(value) ? value : null;
  };
  const price = parseHypotheticalPrice(hypotheticalPrice);
  const profit = price == null ? null : longOptionProfit(terms, price);
  const modelProfit = validContract && profit ? model(price!, vol) : null;
  const prices = [0.5, 0.75, 1, 1.25, 1.5].map((v) => v * initialPrice),
    volStep = Math.min(10, vol * 0.4),
    vols = [-2, -1, 0, 1, 2].map((offset) =>
      Number((vol + offset * volStep).toFixed(4)),
    );
  const timeLabel =
    remaining > 0
      ? `${remaining < 0.01 ? "<0.01" : num(Number(remaining.toFixed(2)))} days left`
      : "At expiration";
  const series = useMemo(
    () =>
      validContract
        ? [
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
              name: `Model · ${timeLabel}`,
              color: "var(--copper)",
              valueAt: (p: number) => model(min + (max - min) * p, vol) ?? 0,
              values: Array.from(
                { length: 81 },
                (_, i) => model(min + ((max - min) * i) / 80, vol) ?? 0,
              ),
            },
          ]
        : [],
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
      validContract,
      remaining,
      max,
      initialPrice,
    ],
  );
  if (!validContract)
    return (
      <div className="options-explorer">
        <p role="alert">
          Enter valid option terms, an actual expiration date, and a positive
          whole contract count to calculate profit.
        </p>
      </div>
    );
  return (
    <div className="options-explorer">
      <section
        className={styles.calculator}
        aria-label="Option profit calculator"
      >
        <h3>What could this option return?</h3>
        <p className={styles.context}>
          {underlying} {right === "CALL" ? "call" : "put"} · expires{" "}
          {expiry.expirationDate} · {num(quantity)}{" "}
          {quantity === 1 ? "contract" : "contracts"} × {num(multiplier)} shares
          per contract. Entry premium: {preciseMoney(premium)} per share.
        </p>
        <label className={styles.price} htmlFor={priceId}>
          Hypothetical underlying price ($)
          <input
            id={priceId}
            type="text"
            inputMode="decimal"
            value={hypotheticalPrice}
            onChange={(e) => setHypotheticalPrice(e.target.value)}
            aria-invalid={!profit}
            aria-describedby={`${priceId}-help`}
          />
          <small id={`${priceId}-help`}>
            {hasSpot
              ? "Starts at the supplied underlying price; edit it to explore a scenario."
              : "Starts at the strike price. No observed underlying quote is used."}{" "}
            This changes the calculator only.
          </small>
          {!profit && (
            <span className={styles.error} role="alert">
              Enter a finite, nonnegative price. Zero is allowed.
            </span>
          )}
        </label>
        <div className={styles.results}>
          <div>
            <h4>Expiration net P/L</h4>
            <output
              className="financial-value"
              aria-label="Expiration net profit or loss"
            >
              {profit ? money(profit.expirationProfit) : "—"}
            </output>
            <p className={styles.context}>
              Intrinsic value less your entry premium.
            </p>
          </div>
          <div>
            <h4>
              {remaining > 0
                ? "Before-expiration model P/L"
                : "Model at expiration"}
            </h4>
            <output
              className="financial-value"
              aria-label="Modeled net profit or loss"
            >
              {modelProfit == null ? "—" : money(modelProfit)}
            </output>
            <p className={styles.context}>
              {timeLabel} · {num(vol)}% volatility
              {remaining === 0 ? " · uses intrinsic value" : " · estimate only"}
              .
            </p>
          </div>
        </div>
        <p className={styles.context}>
          Expiration formula: (intrinsic value per share − entry premium per
          share) × contracts × shares per contract.
        </p>
        {profit && (
          <span
            className={styles.formula}
            aria-label="Substituted expiration profit formula"
          >
            [max(
            {right === "CALL"
              ? `${preciseMoney(price!, 20)} − ${preciseMoney(strike)}`
              : `${preciseMoney(strike)} − ${preciseMoney(price!, 20)}`}
            , $0.00) − {preciseMoney(premium)}] × {num(quantity)} ×{" "}
            {num(multiplier)} = {money(profit.expirationProfit)}
          </span>
        )}
        <p className={styles.assumptions}>
          Fees are excluded. The before-expiration estimate uses Black–Scholes,
          4% annual interest, zero dividends and a European exercise
          approximation.
          {ivEstimated || initialVol !== iv
            ? ` Starting volatility is an assumed ${num(initialVol * 100)}%; no option quote supplies it.`
            : " Volatility is an editable model assumption."}
        </p>
      </section>
      <div className="option-risk-metrics">
        <div>
          <span>Expiration break-even</span>
          <strong className="financial-value">
            {base.breakEven < 0
              ? "No nonnegative break-even"
              : preciseMoney(base.breakEven)}
          </strong>
        </div>
        <div>
          <span>Total entry premium</span>
          <strong className="financial-value">{money(base.premiumPaid)}</strong>
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
      <div className={`two-column ${styles.controls}`}>
        <label>
          Model volatility: {vol}%
          <input
            type="range"
            min={0.01}
            step={0.01}
            max={Math.max(200, Math.ceil(initialVol * 100))}
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
                (expiry.modelExpirationAt.getTime() - valuationAt) / 86400000,
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
                {prices.map((p, index) => (
                  <th key={index}>{money(p)}</th>
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
                            val != null && val >= 0
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
        P/L includes the entry premium. Model changes here are exploratory and
        do not edit an order or holding target.
        {expiry.scheduleStatus !== "KNOWN"
          ? " The expiration-day calendar is unverified; the model assumes a normal Eastern session close."
          : ""}
      </p>
    </div>
  );
}
