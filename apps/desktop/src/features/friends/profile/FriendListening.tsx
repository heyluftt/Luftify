import { ListPlus, Music2, Play } from "lucide-react";
import { AlbumArt } from "../../../components/AlbumArt";
import { t } from "../../../i18n";
import { desktopApi } from "../../../services/desktopApi";
import { playbackCommands } from "../../playback/playbackCommands";
import type { SharedTrack } from "../../listen-together/listenTogetherTypes";
import type { FriendEntry } from "../friendsTypes";
import { playedAgo } from "./friendsTime";

const title = (track: SharedTrack) => track.title || t("listen.untitledTrack");
const artists = (track: SharedTrack) => track.artists?.join(", ") || t("listen.unknownArtist");
const playable = (track: SharedTrack) => track.uri.startsWith("spotify:track:");

/** What a friend is listening to right now, and what came before. */
export function FriendListening({ friend, offline, own = false }: { friend: FriendEntry; offline: boolean; own?: boolean }) {
  const current = offline ? null : friend.presence.track;
  const recent = (offline ? [] : friend.recent ?? []).filter((entry, index) => index > 0 || entry.track.uri !== current?.uri);
  // Nothing shared means nothing to show; the profile stays calm.
  if (!current && !recent.length) return null;
  return <>
    {current && <section className="friend-now" aria-labelledby="friend-now-title">
      {/* The cover, blurred, tints the card in its colours. */}
      {current.coverUri && <span className="friend-now-backdrop" aria-hidden="true"><AlbumArt title="" image={current.coverUri} size="small" /></span>}
      <span className="friend-now-art"><AlbumArt title={title(current)} image={current.coverUri} size="large" priority /></span>
      <div className="friend-now-copy">
        <span className="friend-now-label" id="friend-now-title"><i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />{t("friends.listening")}</span>
        <strong title={title(current)}>{title(current)}</strong>
        <small title={artists(current)}>{artists(current)}</small>
        {!own && playable(current) && <div className="friend-now-actions">
          <button type="button" className="primary-button" onClick={() => playbackCommands.playUri(current.uri)}>
            <Play size={15} aria-hidden="true" fill="currentColor" />{t("friendProfile.playToo")}
          </button>
          <button type="button" className="secondary-button" onClick={() => void desktopApi.addToQueue(current.uri).catch(() => undefined)}>
            <ListPlus size={16} aria-hidden="true" />{t("friendProfile.queue")}
          </button>
        </div>}
      </div>
    </section>}
    {!!recent.length && <section className="friend-recent" aria-labelledby="friend-recent-title">
      <h3 id="friend-recent-title">{t("friendProfile.recent")}</h3>
      <ol>{recent.map((entry) => <li key={`${entry.track.uri}-${entry.playedAtMs}`}>
        <button type="button" disabled={!playable(entry.track)} onClick={() => playbackCommands.playUri(entry.track.uri)}
          aria-label={t("friendProfile.playTrack", { title: title(entry.track) })}>
          <span className="friend-recent-art">
            {entry.track.coverUri ? <AlbumArt title={title(entry.track)} image={entry.track.coverUri} size="tiny" /> : <Music2 size={16} aria-hidden="true" />}
            <Play size={14} aria-hidden="true" fill="currentColor" />
          </span>
          <span className="friend-recent-copy"><strong>{title(entry.track)}</strong><small>{artists(entry.track)}</small></span>
          <time dateTime={new Date(entry.playedAtMs).toISOString()}>{playedAgo(entry.playedAtMs)}</time>
        </button>
      </li>)}</ol>
    </section>}
  </>;
}
