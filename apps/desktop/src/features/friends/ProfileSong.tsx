import { Music2, Play } from "lucide-react";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { playbackCommands } from "../playback/playbackCommands";
import type { SharedTrack } from "../listen-together/listenTogetherTypes";
import { accentColor } from "./appearance";

/** The song pinned to a profile, playable with one click. */
export function ProfileSong({ track, accent, color }: { track: SharedTrack; accent?: string | undefined; color?: string | undefined }) {
  const title = track.title || t("listen.untitledTrack");
  return <section className="profile-song" data-accent={accent} style={accentColor(color)} aria-label={t("appearance.song")}>
    <span className="profile-song-art">
      {track.coverUri ? <AlbumArt title={title} image={track.coverUri} size="small" /> : <Music2 size={18} aria-hidden="true" />}
    </span>
    <span className="profile-song-copy">
      <small>{t("appearance.song")}</small>
      <strong title={title}>{title}</strong>
      <span>{track.artists?.join(", ") || t("listen.unknownArtist")}</span>
    </span>
    <button type="button" className="profile-song-play" onClick={() => playbackCommands.playUri(track.uri)}
      aria-label={t("friendProfile.playTrack", { title })} title={t("friendProfile.playTrack", { title })}>
      <Play size={16} fill="currentColor" aria-hidden="true" />
    </button>
  </section>;
}
