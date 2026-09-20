"use client";
import { compact } from "@/lib/desk-types";
import type { MonthlyResult } from "@/lib/monthly-projection";
import styles from "./monthly.module.css";

export function MonthlyChart({
  rows,
  selected,
}: {
  rows: MonthlyResult[];
  selected: number;
}) {
  const values = rows.flatMap((row) => (row.total == null ? [] : [row.total]));
  if (!values.length)
    return (
      <div className={styles.chartEmpty}>
        Add the missing prices to draw your portfolio path.
      </div>
    );
  const low = Math.min(...values),
    high = Math.max(...values);
  const padding = Math.max((high - low) * 0.12, Math.abs(high) * 0.025, 1);
  const min = Math.max(0, low - padding),
    max = high + padding;
  const x = (index: number) =>
    20 + (index / Math.max(1, rows.length - 1)) * 960;
  const y = (value: number) => 160 - ((value - min) / (max - min)) * 140;
  let connected = false;
  const path = rows
    .map((row, index) => {
      if (row.total == null) {
        connected = false;
        return "";
      }
      const point = `${connected ? "L" : "M"}${x(index).toFixed(2)},${y(row.total).toFixed(2)}`;
      connected = true;
      return point;
    })
    .join(" ");
  return (
    <div className={styles.chart}>
      <div className={styles.chartLabels}>
        <span>Modeled portfolio value · USD</span>
        <span className="financial-number private-value">
          {compact(low)} — {compact(high)}
        </span>
      </div>
      <svg
        role="img"
        aria-label="Monthly portfolio value path. Exact values and month selection are below."
        viewBox="0 0 1000 180"
        preserveAspectRatio="none"
      >
        <line x1="20" y1="160" x2="980" y2="160" className={styles.gridLine} />
        <line x1="20" y1="90" x2="980" y2="90" className={styles.gridLine} />
        <line x1="20" y1="20" x2="980" y2="20" className={styles.gridLine} />
        <line
          x1={x(selected)}
          y1="10"
          x2={x(selected)}
          y2="170"
          className={styles.selectionLine}
        />
        <path
          d={path}
          fill="none"
          stroke="var(--green)"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
        {rows.map((row, index) =>
          row.total == null ? null : (
            <circle
              key={row.date}
              cx={x(index)}
              cy={y(row.total)}
              r={index === selected ? 5 : 3}
              fill="var(--green)"
            />
          ),
        )}
      </svg>
      {values.length < rows.length && (
        <p className="fine-print">
          Gaps mean incomplete inputs. The line does not bridge missing months.
        </p>
      )}
    </div>
  );
}
