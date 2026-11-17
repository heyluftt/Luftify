import { t, type MessageKey } from "../../i18n";
import { phaseLabelKey } from "./DiagnosticOverview";
import type { DiagnosticsContext } from "./useDiagnostics";

const GROUPS: Array<{ titleKey: MessageKey; capabilities: Array<[string, MessageKey]> }> = [
  {
    titleKey: "diagnostics.playback",
    capabilities: [
      ["player.basic", "diagnostics.playback"],
      ["player.seek", "diagnostics.seek"],
      ["player.volume", "diagnostics.volume"],
      ["player.mute", "diagnostics.mute"],
      ["player.shuffle", "diagnostics.shuffle"],
      ["player.repeat", "diagnostics.repeat"],
      ["player.like", "diagnostics.like"],
    ],
  },
  {
    titleKey: "diagnostics.groupQueue",
    capabilities: [
      ["queue.read", "diagnostics.queueRead"],
      ["queue.add", "diagnostics.queueAdd"],
      ["queue.remove", "diagnostics.queueRemove"],
      ["queue.clear", "diagnostics.queueClear"],
      ["queue.reorder", "diagnostics.queueSort"],
    ],
  },
  {
    titleKey: "diagnostics.groupCatalog",
    capabilities: [
      ["search.tracks", "diagnostics.searchTracks"],
      ["search.artists", "diagnostics.searchArtists"],
      ["search.albums", "diagnostics.searchAlbums"],
      ["search.playlists", "diagnostics.searchPlaylists"],
      ["library.playlists", "diagnostics.playlists"],
      ["library.likedTracks", "diagnostics.liked"],
      ["playlist.read", "diagnostics.playlistRead"],
      ["playlist.modify", "diagnostics.playlistModify"],
      ["album.read", "diagnostics.albums"],
      ["artist.read", "diagnostics.artists"],
      ["lyrics.read", "diagnostics.lyrics"],
    ],
  },
];

export function DiagnosticCapabilities({ context }: { context: DiagnosticsContext }) {
  const { state, libre, settings, mockMode } = context;
  const available = new Set(state.capabilities);
  const total = GROUPS.reduce((sum, group) => sum + group.capabilities.length, 0);
  return (
    <section className="capability-section">
      <div className="capability-heading">
        <div>
          <h2>{t("diagnostics.available")}</h2>
          <p>{t("diagnostics.provided", { engine: mockMode ? t("diagnostics.demo") : "Librespot" })}</p>
        </div>
        <span>{t("diagnostics.availableCount", { n: `${available.size}/${total}` })}</span>
      </div>
      {state.status === "checking" ? (
        <p className="diagnostic-empty-copy">{t("diagnostics.reading")}</p>
      ) : available.size === 0 ? (
        <p className="diagnostic-empty-copy">{t("diagnostics.empty")}</p>
      ) : (
        GROUPS.map((group) => (
          <div key={group.titleKey} className="capability-group">
            <h3>{t(group.titleKey)}</h3>
            <div className="capability-cloud">
              {group.capabilities.map(([capability, labelKey]) => (
                <span key={capability} className={available.has(capability) ? "is-available" : "is-missing"}>
                  {t(labelKey)}
                </span>
              ))}
            </div>
          </div>
        ))
      )}
      <details className="diagnostic-technical">
        <summary>{t("diagnostics.details")}</summary>
        <div className="diagnostic-detail-grid">
          <span><small>{t("diagnostics.libreStatus")}</small><strong>{mockMode ? t("diagnostics.demo") : t(phaseLabelKey(libre?.phase))}</strong></span>
          <span><small>{t("diagnostics.account")}</small><strong>{libre?.username?.trim() || t("diagnostics.notReported")}</strong></span>
          <span><small>{t("diagnostics.output")}</small><strong>{settings?.librespotAudioDevice?.trim() || t("diagnostics.defaultDevice")}</strong></span>
          <span><small>{t("diagnostics.quality")}</small><strong>{settings?.librespotStreamingQuality ?? t("diagnostics.notReported")}</strong></span>
          {libre?.message && <span><small>{t("diagnostics.message")}</small><strong>{libre.message}</strong></span>}
        </div>
      </details>
    </section>
  );
}
