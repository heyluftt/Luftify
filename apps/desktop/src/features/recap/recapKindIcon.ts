import { CalendarHeart, CalendarRange, Flower2, Hourglass, Leaf, Snowflake, Sparkles, Sun, type LucideIcon } from "lucide-react";
import type { RecapPeriod } from "./recapTypes";

const SEASON_ICONS: Record<string, LucideIcon> = { spring: Flower2, summer: Sun, autumn: Leaf, winter: Snowflake };

/** A symbol for the kind of look back: season, milestone, year or calendar. */
export function recapKindIcon(period: RecapPeriod): LucideIcon {
  if (period.kind === "season") return SEASON_ICONS[period.id.split("-").pop() ?? ""] ?? CalendarRange;
  if (period.kind === "milestone") return period.id.startsWith("milestone:hours") ? Hourglass : CalendarHeart;
  if (period.kind === "year") return Sparkles;
  return CalendarRange;
}
