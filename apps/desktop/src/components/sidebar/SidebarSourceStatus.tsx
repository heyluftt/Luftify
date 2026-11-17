import { useNavigate } from "react-router-dom";
import { t } from "../../i18n";
import { usePlaybackEngine } from "../../features/playback/usePlaybackEngine";
import { sourceChipPresentation } from "../../features/spotify/sourceChip";

export function SidebarSourceStatus() {
  const navigate = useNavigate();
  const { localPhase, mockMode } = usePlaybackEngine();
  const source = sourceChipPresentation({
    mockMode,
    ...(localPhase ? { librespotPhase: localPhase } : {}),
  });
  return (
    <button
      type="button"
      className="source-chip"
      aria-label={t("nav.openEngine", { title: source.title })}
      title={t("nav.openEngine", { title: source.title })}
      onClick={() => navigate("/settings?focus=playback")}
    >
      <span className={`status-dot is-${source.tone}`} aria-hidden="true" />
      <span className="source-chip-copy">
        <strong>{source.engineLabel}</strong>
        <small>{source.statusLabel}</small>
      </span>
    </button>
  );
}
