import { t } from "../../i18n";
import type { LibraryPhase } from "../library/libraryState";

export function greetingForHour(hour: number): string {
  if (hour < 11) return t("home.morning");
  if (hour < 17) return t("home.afternoon");
  return t("home.evening");
}

export function homeConnectionLabel(phase: LibraryPhase): string {
  if (phase === "offline-cache") return t("home.offline");
  if (phase === "needs-login") return t("home.needsLogin");
  if (phase === "error") return t("home.limited");
  return t("home.connecting");
}

export function homeEntityPath(uri: string): string {
  const encoded = encodeURIComponent(uri);
  if (uri.includes(":album:")) return `/album/${encoded}`;
  if (uri.includes(":artist:")) return `/artist/${encoded}`;
  return `/playlist/${encoded}`;
}
