"use client";
import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  MoveHorizontal,
  SlidersHorizontal,
} from "lucide-react";
import { landingScenario } from "@/lib/landing-scenario";
import { ScenarioRange } from "../ScenarioRange";
import { ValueChart } from "../studio/ValueChart";
import styles from "./landing.module.css";
const dollars = (n: number, decimals = 0) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(n);
export function ScenarioPreview() {
  const [kind, setKind] = useState<"equity" | "option">("equity");
  const [stockTarget, setStockTarget] = useState(2000);
  const [capTarget, setCapTarget] = useState(50);
  const [inputMounted, setInputMounted] = useState(false);
  useEffect(() => setInputMounted(true), []);
  const isEquity = kind === "equity";
  const target = isEquity ? stockTarget : capTarget;
  const scenario = landingScenario(kind, target);
  const downside = scenario.projectedValue < scenario.currentValue;
  const chartColor = downside ? "var(--red)" : "var(--green)";
  const ceiling = isEquity ? 850000 : 3500000;
  const startY = 185 - (scenario.currentValue / ceiling) * 160;
  const endY = 185 - (scenario.projectedValue / ceiling) * 160;
  const points = Array.from({ length: 5 }, (_, i) => ({
    x: 24 + i * 102,
    y: startY + ((endY - startY) * i) / 4,
  }));
  const line = points
    .map(({ x, y }, i) => `${i ? "L" : "M"} ${x} ${y}`)
    .join(" ");
  return (
    <div className={styles.previewStage}>
      <div className={styles.stageLabel}>
        <span className={styles.statusDot} /> YOUR THESIS, IN NUMBERS{" "}
        <span>EXPLORE A SAMPLE</span>
      </div>
      <section
        className={styles.previewCard}
        aria-label="Interactive portfolio example"
      >
        <div className={styles.previewHeader}>
          <span>
            Personal <span className={styles.previewSlash}>/</span> What-if
            scenario
          </span>
          <span className={styles.sampleTag}>ILLUSTRATIVE</span>
        </div>
        <div
          className={styles.previewTabs}
          role="group"
          aria-label="Example investment type"
        >
          <button
            type="button"
            aria-pressed={isEquity}
            onClick={() => setKind("equity")}
          >
            Stocks & ETFs
          </button>
          <button
            type="button"
            aria-pressed={!isEquity}
            onClick={() => setKind("option")}
          >
            Options
          </button>
        </div>
        <div className={styles.previewMetric}>
          <span>Portfolio value at your target</span>
          <output
            aria-live="polite"
            aria-label="Illustrative projected portfolio value"
            className={styles.previewTotal}
          >
            {dollars(scenario.projectedValue)}
          </output>
          <span
            className={`${styles.previewGain} ${downside ? styles.previewLoss : ""}`}
          >
            {downside ? (
              <ArrowDownRight size={14} aria-hidden="true" />
            ) : (
              <ArrowUpRight size={14} aria-hidden="true" />
            )}
            {dollars(scenario.projectedValue - scenario.currentValue)} potential
            scenario change
          </span>
        </div>
        <div className={styles.previewChart}>
          <ValueChart
            label="Illustrative current-to-target comparison"
            interactive={false}
            series={[
              {
                id: "sample",
                name: "Sample portfolio",
                color: chartColor,
                values: Array.from(
                  { length: 21 },
                  (_, i) =>
                    scenario.currentValue +
                    ((scenario.projectedValue - scenario.currentValue) * i) /
                      20,
                ),
              },
            ]}
          />
          <span className={styles.chartCaption}>
            A scenario comparison, not a forecast.
          </span>
        </div>
        <div className={styles.previewControl}>
          <div className={styles.previewControlLabel}>
            <label htmlFor="landing-target">
              <SlidersHorizontal size={14} aria-hidden="true" />
              {isEquity ? "TSLA share-price target" : "BTG market-cap target"}
            </label>
            <output htmlFor="landing-target">
              {isEquity ? dollars(target) : `$${target}B`}
            </output>
          </div>
          <div className={styles.preciseTarget}>
            <label>
              <span>
                Exact {isEquity ? "price · USD" : "valuation · billions USD"}
              </span>
              {inputMounted ? (
                <input
                  aria-label={
                    isEquity
                      ? "Exact sample share-price target"
                      : "Exact sample market-cap target in billions"
                  }
                  type="number"
                  min={0}
                  max={isEquity ? 2500 : 75}
                  step="any"
                  value={target}
                  onChange={(e) => {
                    const v = Math.min(
                      isEquity ? 2500 : 75,
                      Math.max(0, Number(e.target.value)),
                    );
                    isEquity ? setStockTarget(v) : setCapTarget(v);
                  }}
                />
              ) : (
                // Match the slider's mount boundary: form annotations must not
                // change an SSR input before React hydrates the example.
                <span data-number-placeholder="" aria-hidden="true">
                  {target}
                </span>
              )}
            </label>
            <button
              type="button"
              onClick={() => {
                setStockTarget(2000);
                setCapTarget(50);
              }}
            >
              Reset example
            </button>
          </div>
          <ScenarioRange
            id="landing-target"
            min={0}
            max={isEquity ? 2500 : 75}
            step={isEquity ? 100 : 5}
            value={target}
            aria-valuetext={
              isEquity
                ? `${target} dollars per share`
                : `${target} billion dollar market cap`
            }
            onChange={(e) =>
              isEquity
                ? setStockTarget(Number(e.target.value))
                : setCapTarget(Number(e.target.value))
            }
          />
          <div className={styles.rangeEnds}>
            <span>{isEquity ? "$0" : "$0B"}</span>
            <span>
              <MoveHorizontal size={12} aria-hidden="true" /> Move to explore
            </span>
            <span>{isEquity ? "$2,500" : "$75B"}</span>
          </div>
        </div>
        <div className={styles.previewHolding}>
          <div>
            <span className={styles.tickerMark}>{isEquity ? "T" : "B"}</span>
            <div>
              <strong>{isEquity ? "TSLA" : "BTG $5 calls"}</strong>
              <span>
                {isEquity ? "228 shares" : "600 contracts / 100 shares each"}
              </span>
            </div>
          </div>
          <div>
            <span>Holding at target</span>
            <strong data-testid="landing-holding-value">
              {dollars(scenario.projectedHolding)}
            </strong>
          </div>
        </div>
      </section>
      <p className={styles.previewNote}>
        {isEquity
          ? "Example: $250,000 starting cash, 228 shares at a $320.05 sample entry. Projected total includes uninvested cash."
          : "Example: $250,000 starting cash, $1.83 premium and 1.35B assumed shares outstanding. Intrinsic value only, plus cash. Excludes time value."}
      </p>
    </div>
  );
}
