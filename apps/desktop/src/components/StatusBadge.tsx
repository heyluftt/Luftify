export function StatusBadge({ state, label }: { state: "online" | "offline" | "warning" | "mock"; label: string }) {
  return <span className={`status-badge ${state}`}><span className="status-dot" />{label}</span>;
}

