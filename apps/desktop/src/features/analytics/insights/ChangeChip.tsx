import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { appLanguage } from "../../../i18n";

const PERCENT = new Intl.NumberFormat(appLanguage(), { style: "percent", maximumFractionDigits: 0 });

/** "+18 %" against the period before; within 2 % counts as the same. */
export function ChangeChip({ value, label }: { value: number | undefined; label: string }) {
  if (value === undefined || !Number.isFinite(value)) return null;
  const flat = Math.abs(value) < 0.02;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return <span className="insights-change" data-trend={flat ? "flat" : value > 0 ? "up" : "down"} title={label}>
    <Icon size={13} aria-hidden="true" />{flat ? `±${PERCENT.format(0)}` : PERCENT.format(Math.abs(value))}
    <span className="sr-only">{label}</span>
  </span>;
}
