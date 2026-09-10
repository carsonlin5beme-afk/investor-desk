"use client";
import { useMemo, useState } from "react";
import { Maximize2, ArrowRight } from "lucide-react";
import { type Holding, money } from "@/lib/desk-types";
import { assetFromHolding, valueAt, totalAt } from "@/lib/studio";
import { ValueChart } from "./ValueChart";
import { Segmented } from "./Controls";
export function Trajectory({
  holdings,
  cash,
  mode,
  setMode,
  onStudio,
  onTarget,
}: {
  holdings: Holding[];
  cash: number;
  mode: "model" | "intrinsic";
  setMode: (m: "model" | "intrinsic") => void;
  onStudio: () => void;
  onTarget: (h: Holding) => void;
}) {
  const assets = useMemo(() => holdings.map(assetFromHolding), [holdings]),
    [progress, setProgress] = useState(1),
    [contributions, setContributions] = useState(false);
  const at = useMemo(() => Date.now(), [assets]);
  const values = useMemo(
    () =>
      Array.from({ length: 41 }, (_, i) =>
        totalAt(assets, cash, i / 40, mode, undefined, at),
      ),
    [assets, cash, mode, at],
  );
  const contribution = assets
    .map((a, i) => ({
      h: holdings[i],
      value: valueAt(a, 1, mode, undefined, at) - a.currentValue,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const maxContribution = Math.max(
    ...contribution.map((c) => Math.abs(c.value)),
    1,
  );
  return (
    <section className="panel trajectory">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Your conviction, in perspective</span>
          <h2>From here to your targets</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Open scenario studio"
          onClick={onStudio}
        >
          <Maximize2 size={18} />
        </button>
      </div>
      <div className="chart-headline">
        <strong className="private-value">
          {money(totalAt(assets, cash, progress, mode, undefined, at), 0)}
        </strong>
        <span>{Math.round(progress * 100)}% toward your targets</span>
      </div>
      <Segmented
        label="Target valuation method"
        value={mode}
        options={[
          { value: "model", label: "Model estimate" },
          { value: "intrinsic", label: "Intrinsic targets" },
        ]}
        onChange={setMode}
      />
      <ValueChart
        series={[
          {
            id: "total",
            name: "Portfolio",
            color: "var(--green)",
            values,
            valueAt: (p) => totalAt(assets, cash, p, mode, undefined, at),
          },
        ]}
        label="Hypothetical portfolio value toward all targets"
        onProgress={setProgress}
      />
      <div className="chart-context">
        <span className="badge subtle">Hypothetical scenario</span>
        <p>
          Every holding moves toward its own target together. The horizontal
          axis is scenario progress, not time or probability.
        </p>
      </div>
      <button
        className="text-button"
        aria-expanded={contributions}
        onClick={() => setContributions((v) => !v)}
      >
        {contributions ? "Hide" : "See"} what drives the change{" "}
        <ArrowRight size={15} />
      </button>
      {contributions && (
        <div className="contribution-list">
          <div className="contribution-endpoint">
            <span>Current value</span>
            <strong>{money(values[0])}</strong>
          </div>
          {contribution.map(({ h, value }) => (
            <button key={h.id} onClick={() => onTarget(h)}>
              <span>
                {h.optionDetails?.underlying ?? h.symbol}
                <small>{h.optionDetails?.right ?? "Shares"}</small>
              </span>
              <span className="contribution-track">
                <i
                  className={value < 0 ? "loss" : ""}
                  style={{
                    width: `${(Math.abs(value) / maxContribution) * 100}%`,
                  }}
                />
              </span>
              <strong className={value >= 0 ? "positive" : "negative"}>
                {value > 0 ? "+" : ""}
                {money(value, 0)}
              </strong>
            </button>
          ))}
          <div className="contribution-endpoint">
            <span>At your targets</span>
            <strong>{money(values.at(-1))}</strong>
          </div>
        </div>
      )}
    </section>
  );
}
