import { t } from "../../i18n";
import type { LibrespotPhase } from "../../types/tauri";

export type SourceChipTone = "online" | "warning" | "offline";

export interface SourceChipPresentation {
  engineLabel: string;
  statusLabel: string;
  tone: SourceChipTone;
  title: string;
}

export function sourceChipPresentation(input: {
  librespotPhase?: LibrespotPhase;
  mockMode?: boolean;
}): SourceChipPresentation {
  if (input.mockMode) {
    const statusLabel = t("chip.demo");
    return { engineLabel: "Luftify", statusLabel, tone: "online", title: `Luftify · ${statusLabel}` };
  }
  const statusLabel = librespotPhaseLabel(input.librespotPhase);
  const engineLabel = "Librespot";
  return {
    engineLabel,
    statusLabel,
    tone: librespotPhaseTone(input.librespotPhase),
    title: `${engineLabel} · ${statusLabel}`,
  };
}

export function librespotPhaseLabel(phase: LibrespotPhase | undefined): string {
  switch (phase) {
    case "ready":
      return t("chip.ready");
    case "connecting":
    case "authenticating":
      return t("chip.connecting");
    case "needsLogin":
      return t("chip.needsLogin");
    case "error":
      return t("chip.error");
    case "disconnected":
      return t("chip.disconnected");
    default:
      return t("chip.starting");
  }
}

export function librespotPhaseTone(phase: LibrespotPhase | undefined): SourceChipTone {
  if (phase === "ready") return "online";
  if (phase === "needsLogin" || phase === "error" || phase === "disconnected") {
    return "offline";
  }
  return "warning";
}
