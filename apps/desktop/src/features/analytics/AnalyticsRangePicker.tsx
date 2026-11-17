import { t } from "../../i18n";
import { ANALYTICS_RANGES } from "./analyticsRanges";
import type { AnalyticsRangeKey } from "./analyticsTypes";

export function AnalyticsRangePicker({
  value,
  onChange,
}: {
  value: AnalyticsRangeKey;
  onChange: (value: AnalyticsRangeKey) => void;
}) {
  return (
    <div
      className="analytics-range-picker"
      role="radiogroup"
      aria-label={t("analytics.rangeAria")}
    >
      {ANALYTICS_RANGES.map((range) => (
        <button
          key={range.key}
          type="button"
          role="radio"
          aria-checked={value === range.key}
          onClick={() => onChange(range.key)}
        >
          {t(range.labelKey)}
        </button>
      ))}
    </div>
  );
}
