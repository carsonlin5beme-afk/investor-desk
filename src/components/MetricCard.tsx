interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
}

export function MetricCard({ label, value, hint }: MetricCardProps) {
  return (
    <article className="panel metric">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint ? <small className="mono">{hint}</small> : null}
    </article>
  );
}
