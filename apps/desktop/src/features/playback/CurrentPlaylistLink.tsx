import { ArrowRight, ListMusic } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { t } from "../../i18n";
import { usePlaybackPlaylistContext } from "./usePlaybackPlaylistContext";
import { useNowPlayingListNavigationEnabled } from "./useNowPlayingListPreference";

interface CurrentPlaylistLinkProps {
  connected: boolean;
  contextUri: string | undefined;
  currentTrackUri: string | undefined;
}

export function CurrentPlaylistLink({
  connected,
  contextUri,
  currentTrackUri,
}: CurrentPlaylistLinkProps) {
  const playlist = usePlaybackPlaylistContext(contextUri, connected);
  const navigationEnabled = useNowPlayingListNavigationEnabled();
  const navigate = useNavigate();
  const location = useLocation();
  if (!playlist) return null;

  const openPlaylist = () => {
    const path = `/playlist/${encodeURIComponent(playlist.uri)}`;
    // Router navigation (not a raw hash write) keeps PUSH distinct from
    // back/forward. Repeated jumps on the open playlist replace the entry,
    // so "Back" leaves the playlist instead of replaying old jumps.
    const replace = location.pathname === path;
    if (!navigationEnabled || !currentTrackUri) {
      navigate(path, { replace });
      return;
    }
    const query = new URLSearchParams({
      nowPlaying: currentTrackUri,
      focusRequest: Date.now().toString(36),
    });
    navigate(`${path}?${query.toString()}`, { replace });
  };

  const title = navigationEnabled && currentTrackUri
    ? t("player.openPlaylistTrack", { name: playlist.name })
    : t("player.openPlaylist", { name: playlist.name });

  return (
    <button
      type="button"
      className="current-playlist-link"
      title={title}
      aria-label={title}
      onClick={openPlaylist}
    >
      <ListMusic size={11} aria-hidden="true" />
      <span className="current-playlist-prefix">{t("player.fromPrefix")}</span>
      <span className="current-playlist-name">{playlist.name}</span>
      <ArrowRight
        className="current-playlist-arrow"
        size={11}
        aria-hidden="true"
      />
    </button>
  );
}
