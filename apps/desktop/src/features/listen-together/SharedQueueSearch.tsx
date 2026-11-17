import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Search } from "lucide-react";
import { desktopApi } from "../../services/desktopApi";
import { t } from "../../i18n";
import type { SharedTrack } from "./listenTogetherTypes";
import { SharedQueueTrackResult } from "./SharedQueueTrackResult";
import { SharedQueueCollectionRow } from "./SharedQueueCollectionRow";
import type { RoomAddSource } from "./useRoomQueueAdd";

const COLLECTIONS_SHOWN = 3;

export function SharedQueueSearch({ disabled, canAdd, canPlay, onPlay, onAdd, onAddMany }: {
  disabled: boolean;
  canAdd: boolean;
  canPlay: boolean;
  onPlay: (track: SharedTrack) => void;
  onAdd: (track: SharedTrack) => void;
  onAddMany: (source: RoomAddSource, next: boolean) => void;
}) {
  const inputId = useId();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const result = useQuery({ queryKey: ["shared-queue-search", search],
    queryFn: ({ signal }) => desktopApi.search({ query: search, offset: 0, limit: 10 }, signal),
    enabled: search.length >= 2, staleTime: 30_000, retry: false });
  const data = result.data;
  const empty = data && !data.tracks.length && !data.albums.length && !data.playlists.length;
  return <div className="shared-queue-search">
    <p className="shared-selection-hint">{t(canPlay ? "listen.selection.hint" : "listen.selection.guestHint")}</p>
    <form onSubmit={(event) => { event.preventDefault(); if (!disabled && input.trim().length >= 2) setSearch(input.trim()); }}>
      <label htmlFor={inputId}>{t("listen.queueSearch")}</label>
      <div className="listen-join-controls"><input id={inputId} value={input} maxLength={160} onChange={(event) => setInput(event.currentTarget.value)} placeholder={t("listen.queueSearchHint")} />
        <button className="secondary-button" type="submit" disabled={disabled || input.trim().length < 2}><Search size={17} aria-hidden="true" />{t("listen.queueSearch")}</button></div>
    </form>
    {result.isFetching && <p role="status">{t("listen.queueSearching")}</p>}
    {result.isError && <p role="alert">{t("listen.queueSearchError")}</p>}
    {search && result.isSuccess && empty && <p>{t("listen.queueNoResults")}</p>}
    {!!data?.tracks.length && <>
      <h3 className="shared-queue-group">{t("listen.queueSongs")}</h3>
      <ul className="shared-queue-results">{data.tracks.map((track) => <SharedQueueTrackResult key={track.uri} item={track} disabled={disabled} canAdd={canAdd} canPlay={canPlay} onPlay={onPlay} onAdd={onAdd} onAddMany={onAddMany} />)}</ul>
    </>}
    {!!data?.albums.length && <>
      <h3 className="shared-queue-group">{t("listen.queueAlbums")}</h3>
      <ul className="shared-queue-results shared-queue-collections">{data.albums.slice(0, COLLECTIONS_SHOWN).map((album) =>
        <SharedQueueCollectionRow key={album.uri} entity={album} disabled={disabled || !canAdd} onAddMany={onAddMany} />)}</ul>
    </>}
    {!!data?.playlists.length && <>
      <h3 className="shared-queue-group">{t("listen.queuePlaylists")}</h3>
      <ul className="shared-queue-results shared-queue-collections">{data.playlists.slice(0, COLLECTIONS_SHOWN).map((playlist) =>
        <SharedQueueCollectionRow key={playlist.uri} entity={playlist} disabled={disabled || !canAdd} onAddMany={onAddMany} />)}</ul>
    </>}
  </div>;
}
