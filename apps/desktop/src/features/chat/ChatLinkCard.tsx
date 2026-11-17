import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AlbumArt } from "../../components/AlbumArt";
import { t } from "../../i18n";
import { albumDestination } from "../entities/mediaDestinations";
import { linkQuery } from "../links/linkLookup";
import type { SpotifyLink } from "../links/spotifyLink";
import { usePlaybackActions } from "../playback/usePlayback";
import { searchEntityPath } from "../search/useSearchHitActions";

const KIND_KEY = {
  track: "search.kind.track", album: "search.kind.album", artist: "search.kind.artist", playlist: "search.kind.playlist",
} as const;

/** A Spotify link in a message, shown as what it points to: play it or open its page in Luftify. */
export function ChatLinkCard({ link }: { link: SpotifyLink }) {
  const navigate = useNavigate();
  const { playUri } = usePlaybackActions();
  const target = useQuery(linkQuery(link)).data;
  const kind = t(KIND_KEY[link.kind]);
  const title = target?.kind === "track" ? target.track.title : target?.kind === "entity" ? target.entry.name : kind;
  const detail = target?.kind === "track" ? target.track.creators.map((creator) => creator.name).join(", ")
    : target?.kind === "entity" ? target.entry.subtitle : undefined;
  const cover = target?.kind === "track" ? target.track.coverUri : target?.kind === "entity" ? target.entry.coverUri : undefined;
  const page = link.kind === "track"
    ? target?.kind === "track" ? albumDestination(target.track)?.path : undefined
    : searchEntityPath(`${link.kind}s`, link.uri);
  return <div className="chat-link-card" data-kind={link.kind}>
    <AlbumArt title={title} image={cover} size="small" />
    <span className="chat-link-copy"><strong>{title}</strong><small>{[kind, detail].filter(Boolean).join(" · ")}</small></span>
    {link.kind !== "artist" && <button type="button" className="friends-icon-button" title={t("chat.play")} aria-label={t("chat.play")}
      onClick={() => void playUri(link.uri)}><Play size={16} aria-hidden="true" /></button>}
    {page && <button type="button" className="friends-icon-button" title={t("chat.open")} aria-label={t("chat.open")}
      onClick={() => navigate(page)}><ExternalLink size={16} aria-hidden="true" /></button>}
  </div>;
}
