import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import { usePlayback } from "../playback/usePlayback";
import { MiniPlayerBrowse, type MiniPlayerPanel } from "./MiniPlayerBrowse";
import { MiniPlayerControls } from "./MiniPlayerControls";
import { MiniPlayerLock } from "./MiniPlayerLock";
import { MiniPlayerProgress } from "./MiniPlayerProgress";
import { MiniPlayerQuickSettings } from "./MiniPlayerQuickSettings";
import { MiniPlayerTools } from "./MiniPlayerTools";
import { startMiniPlayerDrag, usePersistMiniPlayerPosition } from "./miniplayerWindow";
import { useMiniPlayerSettings } from "./useMiniPlayerSettings";

export function MiniPlayer() {
  const { playback, command, connected, transportPending } = usePlayback();
  const { settings, update: updateSettings } = useMiniPlayerSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panel, setPanel] = useState<MiniPlayerPanel | null>(null);
  useEffect(() => {
    void desktopApi.setMiniplayerExpanded(panel !== null).catch(() => setPanel(null));
  }, [panel]);
  useEffect(() => {
    if (settings.clickThrough) { setSettingsOpen(false); setPanel(null); }
  }, [settings.clickThrough]);
  usePersistMiniPlayerPosition();
  useKeepMiniPlayerInPlace();
  useEffect(() => {
    document.documentElement.classList.add("miniplayer-root");
    document.body.classList.add("miniplayer-body");
    return () => {
      document.documentElement.classList.remove("miniplayer-root");
      document.body.classList.remove("miniplayer-body");
    };
  }, []);

  const item = playback?.currentItem;
  const artists = item?.creators.map((creator) => creator.name).join(", ");
  const backdrop = useCoverBackdrop(item?.coverUri);
  const transportBusy = !connected;

  const togglePanel = (next: MiniPlayerPanel) => {
    setSettingsOpen(false);
    setPanel((current) => current === next ? null : next);
  };

  // The window only has focus after a click into it, so these never steal
  // keys from a game: space plays or pauses, arrows skip.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      setPanel(null);
      setSettingsOpen(false);
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [role='slider']")) return;
    if (event.code === "Space" && connected) {
      event.preventDefault();
      command({ command: playback?.isPlaying ? "pause" : "play" });
    } else if (event.key === "ArrowRight" && !transportBusy) {
      event.preventDefault();
      command({ command: "next" });
    } else if (event.key === "ArrowLeft" && !transportBusy) {
      event.preventDefault();
      command({ command: "previous" });
    }
  };

  return (
    <main
      className={["miniplayer-app", panel ? "expanded" : "", settingsOpen ? "is-tuning" : ""].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
      style={{
        "--miniplayer-opacity": settings.opacityPercent / 100,
        width: `${100 / settings.scale}%`,
        height: `${100 / settings.scale}%`,
        transform: `scale(${settings.scale})`,
      } as CSSProperties}
      aria-label={t("miniplayer.controls")}
    >
      <div
        className={settingsOpen ? "miniplayer-card settings-open" : "miniplayer-card"}
        style={backdrop ? { "--miniplayer-art": `url("${backdrop}")` } as CSSProperties : undefined}
      >
        {settingsOpen ? (
          <MiniPlayerQuickSettings settings={settings} update={updateSettings} />
        ) : (
          <>
            <div
              className="miniplayer-drag-region"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                void startMiniPlayerDrag().catch(console.error);
              }}
            >
              <div className="miniplayer-cover" aria-hidden="true">
                <AlbumArt title={item?.title ?? t("player.noTrack")} size="small" image={item?.coverUri} priority />
              </div>
              <div className="miniplayer-copy">
                <strong title={item?.title}>{item?.title ?? t("player.noTrack")}</strong>
                <span title={artists}>{artists || t("player.unknownArtist")}</span>
              </div>
            </div>
            <MiniPlayerControls panel={panel} onPanel={togglePanel} />
            <MiniPlayerProgress />
          </>
        )}
        {settings.clickThrough ? (
          <MiniPlayerLock />
        ) : (
          <MiniPlayerTools
            settingsOpen={settingsOpen}
            onSettings={() => { setPanel(null); setSettingsOpen((open) => !open); }}
            onHide={() => { setPanel(null); void desktopApi.hideMiniplayer(); }}
          />
        )}
      </div>
      {panel && <MiniPlayerBrowse panel={panel} close={() => setPanel(null)} />}
    </main>
  );
}

/**
 * The window is exactly as large as the player, so nothing may scroll. CSS
 * already stops wheel scrolling, but focusing a control (or a list row)
 * while the window is resizing still scrolls the page programmatically and
 * pushed the player out of view; any such offset is undone at once.
 */
function useKeepMiniPlayerInPlace() {
  useEffect(() => {
    const reset = (event: Event) => {
      const target = event.target;
      const element = target === document ? document.scrollingElement : target;
      if (!(element instanceof HTMLElement)) return;
      if (element.closest(".miniplayer-browse-list")) return;
      if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
        element.scrollTop = 0;
        element.scrollLeft = 0;
      }
    };
    document.addEventListener("scroll", reset, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", reset, { capture: true });
  }, []);
}

/** The cover as a data URL (shared with AlbumArt's cache) for the blurred card backdrop. */
function useCoverBackdrop(coverUri: string | undefined): string | undefined {
  const remote = coverUri?.startsWith("https://") ? coverUri : undefined;
  const cover = useQuery({
    queryKey: ["cover", remote],
    queryFn: () => desktopApi.coverData(remote!),
    enabled: Boolean(remote),
    staleTime: Infinity,
    retry: false,
  });
  if (coverUri?.startsWith("data:image/")) return coverUri;
  return cover.data ?? undefined;
}
