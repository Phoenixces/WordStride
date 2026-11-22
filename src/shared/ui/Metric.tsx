export function Metric({ label, value, secondary }: { label: string; value: string; secondary?: string }) {
  return <div className={`metric${secondary ? ' has-secondary' : ''}`}><span className="eyebrow">{label}</span><div className="metric-values"><strong>{value}</strong>{secondary && <span className="metric-secondary">{secondary}</span>}</div></div>;
}

