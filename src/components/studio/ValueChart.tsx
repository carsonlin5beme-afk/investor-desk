"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Pin, RotateCcw, Table2 } from "lucide-react";
import { compact, money } from "@/lib/desk-types";
export type ChartSeries = {
  id: string;
  name: string;
  color: string;
  values: number[];
  valueAt?: (progress: number) => number;
};
export function ValueChart({
  series,
  label,
  xLabel = "Progress toward each target (%)",
  xMin = 0,
  xMax = 100,
  reference,
  xUnit = "percent",
  yLabel = "Value · USD",
  interactive = true,
  onProgress,
}: {
  series: ChartSeries[];
  label: string;
  xLabel?: string;
  xMin?: number;
  xMax?: number;
  reference?: number;
  xUnit?: "percent" | "usd";
  yLabel?: string;
  interactive?: boolean;
  onProgress?: (p: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    id = useId().replaceAll(":", ""),
    [width, setWidth] = useState(620),
    [position, setPosition] = useState(100),
    [pinned, setPinned] = useState(false),
    [table, setTable] = useState(false),
    [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    const r = root.current;
    if (!r) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(220, entry.contentRect.width)),
    );
    observer.observe(r);
    return () => observer.disconnect();
  }, []);
  const visible = series.filter((s) => !hidden.includes(s.id));
  const shown = visible.length ? visible : series;
  const formatX = (v: number, tick = false) =>
    xUnit === "usd"
      ? money(v, tick && v >= 100 ? 0 : 2)
      : `${Number(v.toFixed(2))}%`;
  const domain = useMemo(() => {
    const values = shown.flatMap((s) => s.values);
    if (reference != null) values.push(reference);
    let low = Math.min(...values, 0),
      high = Math.max(...values, 1);
    if (low >= 0 && high > 0) {
      low = Math.min(...values) * 0.9;
      if (low < high * 0.25) low = 0;
    }
    const span = high - low || 1;
    return [low - (low < 0 ? span * 0.07 : 0), high + span * 0.08];
  }, [shown, reference]);
  const left = width < 400 ? 63 : 75,
    right = 20,
    top = 22,
    bottom = 55,
    height = 280,
    plotW = width - left - right,
    plotH = height - top - bottom;
  const x = (p: number) => left + p * plotW,
    y = (v: number) =>
      top + plotH - ((v - domain[0]) / (domain[1] - domain[0])) * plotH;
  const sample = (s: ChartSeries, p: number) => {
    if (s.valueAt) return s.valueAt(Math.max(0, Math.min(1, p)));
    const at = Math.min(1, Math.max(0, p)) * (s.values.length - 1),
      a = Math.floor(at),
      b = Math.min(s.values.length - 1, a + 1);
    return s.values[a] + (s.values[b] - s.values[a]) * (at - a);
  };
  const update = (p: number) => {
    const v = Math.round(Math.max(0, Math.min(100, p)));
    setPosition(v);
    onProgress?.(v / 100);
  };
  const inspect = (clientX: number) => {
    if (!root.current) return;
    update(
      ((clientX - root.current.getBoundingClientRect().left - left) / plotW) *
        100,
    );
  };
  const ticks = width < 400 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="value-chart" ref={root}>
      {series.length > 1 && (
        <div className="chart-legend" aria-label="Chart series">
          {series.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={shown.some((v) => v.id === s.id)}
              onClick={() =>
                setHidden(() => {
                  const activeIds = shown.map((v) => v.id);
                  const next = activeIds.includes(s.id)
                    ? activeIds.length > 1
                      ? activeIds.filter((id) => id !== s.id)
                      : activeIds
                    : [...activeIds, s.id];
                  return series
                    .filter((v) => !next.includes(v.id))
                    .map((v) => v.id);
                })
              }
            >
              <i style={{ background: s.color }} />
              {s.name}
            </button>
          ))}
        </div>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-labelledby={`${id}-title ${id}-desc`}
        className="analytical-svg"
      >
        <title id={`${id}-title`}>{label}</title>
        <desc id={`${id}-desc`}>
          {xLabel}.{" "}
          {shown
            .map(
              (s) =>
                `${s.name}: ${money(s.values[0])} to ${money(s.values.at(-1))}`,
            )
            .join(". ")}
          . Exact values are available in the data table.
        </desc>
        <defs>
          <clipPath id={`${id}-clip`}>
            <rect x={left} y={top} width={plotW} height={plotH} />
          </clipPath>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--green)" stopOpacity=".16" />
            <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const v = domain[0] + (domain[1] - domain[0]) * p;
          return (
            <g key={p}>
              <line
                x1={left}
                x2={width - right}
                y1={y(v)}
                y2={y(v)}
                className="chart-gridline"
              />
              <text x={left - 10} y={y(v) + 4} textAnchor="end">
                {compact(v)}
              </text>
            </g>
          );
        })}
        {ticks.map((p) => (
          <text
            key={p}
            x={x(p)}
            y={height - 31}
            textAnchor={p === 0 ? "start" : p === 1 ? "end" : "middle"}
          >
            {formatX(xMin + (xMax - xMin) * p, true)}
          </text>
        ))}
        <text x={left} y={12} className="chart-axis-title">
          {yLabel}
        </text>
        <text
          x={left + plotW / 2}
          y={height - 8}
          textAnchor="middle"
          className="chart-axis-title"
        >
          {xLabel}
        </text>
        <g clipPath={`url(#${id}-clip)`}>
          {reference != null && (
            <line
              x1={left}
              x2={width - right}
              y1={y(reference)}
              y2={y(reference)}
              className="chart-reference"
            />
          )}
          {shown.map((s, index) => {
            const path = s.values
              .map(
                (v, i) =>
                  `${i ? "L" : "M"}${x(i / (s.values.length - 1)).toFixed(1)},${y(v).toFixed(1)}`,
              )
              .join(" ");
            return (
              <g key={s.id}>
                {shown.length === 1 && (
                  <path
                    d={`${path} L${width - right},${top + plotH} L${left},${top + plotH}Z`}
                    fill={`url(#${id}-fill)`}
                  />
                )}
                <path
                  d={path}
                  fill="none"
                  className="chart-series-path"
                  strokeDasharray={
                    index > 0 ? `${7 - index} ${3 + index}` : undefined
                  }
                  stroke={s.color}
                  strokeWidth={index === 0 ? 2.8 : 2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          {interactive && (
            <>
              <line
                x1={x(position / 100)}
                x2={x(position / 100)}
                y1={top}
                y2={top + plotH}
                className="chart-guide"
              />
              {shown.map((s) => (
                <circle
                  key={s.id}
                  cx={x(position / 100)}
                  cy={y(sample(s, position / 100))}
                  r={5}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ))}
            </>
          )}
        </g>
        {interactive && (
          <rect
            x={left}
            y={top}
            width={plotW}
            height={plotH}
            fill="transparent"
            className="chart-hit"
            onPointerMove={(e) => {
              if (!pinned && e.pointerType === "mouse") inspect(e.clientX);
            }}
            onPointerDown={(e) => {
              inspect(e.clientX);
              setPinned((v) => (e.pointerType === "mouse" ? !v : true));
            }}
          />
        )}
      </svg>
      {interactive && (
        <>
          <div className="chart-readout" aria-live="off">
            <span>
              {formatX(xMin + ((xMax - xMin) * position) / 100)}
              {xUnit === "percent" ? " toward targets" : " · selected price"}
            </span>
            <div>
              {shown.map((s) => {
                const value = sample(s, position / 100);
                return (
                  <span key={s.id}>
                    <i style={{ background: s.color }} />
                    {series.length > 1 && `${s.name} `}
                    <strong
                      className={
                        value < 0
                          ? "numeric-readout negative"
                          : "numeric-readout"
                      }
                    >
                      {money(value)}
                    </strong>
                  </span>
                );
              })}
            </div>
          </div>
          <div className="chart-control-row">
            <label>
              <span className="sr-only">
                {label}: {xLabel}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={position}
                aria-label={`${label}: ${xLabel}`}
                aria-valuetext={`${formatX(xMin + ((xMax - xMin) * position) / 100)}, ${shown.map((s) => `${s.name} ${money(sample(s, position / 100))}`).join(", ")}`}
                onChange={(e) => {
                  update(Number(e.target.value));
                  setPinned(true);
                }}
              />
            </label>
            <button
              type="button"
              className={`icon-button ${pinned ? "selected" : ""}`}
              aria-label={pinned ? "Unpin chart details" : "Pin chart details"}
              aria-pressed={pinned}
              onClick={() => setPinned((v) => !v)}
            >
              <Pin size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Reset chart"
              onClick={() => {
                update(100);
                setPinned(false);
                setHidden([]);
              }}
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </>
      )}
      <button
        type="button"
        className="text-button chart-table-toggle"
        aria-expanded={table}
        onClick={() => setTable((v) => !v)}
      >
        <Table2 size={14} />
        {table ? "Hide" : "View"} exact data
      </button>
      {table && (
        <div className="table-scroll">
          <table className="chart-data">
            <caption>{label}</caption>
            <thead>
              <tr>
                <th>{xLabel}</th>
                {shown.map((s) => (
                  <th key={s.id}>{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 11 }, (_, i) => i / 10).map((p) => (
                <tr key={p}>
                  <td>{formatX(xMin + (xMax - xMin) * p)}</td>
                  {shown.map((s) => (
                    <td key={s.id}>{money(sample(s, p))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
