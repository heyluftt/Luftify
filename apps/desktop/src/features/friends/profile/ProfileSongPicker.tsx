import { useQuery } from "@tanstack/react-query";
import { Music2, Search, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { AlbumArt } from "../../../components/AlbumArt";
import { t } from "../../../i18n";
import { desktopApi } from "../../../services/desktopApi";
import { usePlayerStore } from "../../../stores/playerStore";
import type { SharedTrack } from "../../listen-together/listenTogetherTypes";
import { sharedTrack } from "../../listen-together/roomQueueBatch";

/** Pick the profile song: the one playing now, or one from a search. */
export function ProfileSongPicker({ value, disabled, onChange }: { value: SharedTrack | null; disabled: boolean; onChange: (track: SharedTrack | null) => void }) {
  const inputId = useId();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(input.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [input]);
  const playing = usePlayerStore((state) => state.playback?.currentItem);
  const current = playing ? sharedTrack(playing) : null;
  const results = useQuery({
    queryKey: ["profile-song-search", search],
    queryFn: ({ signal }) => desktopApi.search({ query: search, offset: 0, limit: 5 }, signal),
    enabled: search.length >= 2,
    staleTime: 30_000,
    retry: false,
  });
  const tracks = (results.data?.tracks ?? []).map(sharedTrack).filter((track): track is SharedTrack => Boolean(track)).slice(0, 5);

  return <div className="profile-song-picker">
    {value ? <div className="profile-song-choice">
      <TrackLine track={value} />
      <button type="button" className="friends-icon-button" disabled={disabled} onClick={() => onChange(null)}
        title={t("appearance.songRemove")} aria-label={t("appearance.songRemove")}><X size={16} aria-hidden="true" /></button>
    </div> : <p className="profile-song-empty">{t("appearance.songEmpty")}</p>}
    {current && current.uri !== value?.uri && <button type="button" className="secondary-button profile-song-current" disabled={disabled} onClick={() => onChange(current)}>
      <Music2 size={15} aria-hidden="true" />{t("appearance.songUseCurrent", { title: current.title ?? "" })}
    </button>}
    <label className="shared-queue-filter" htmlFor={inputId}><Search size={15} aria-hidden="true" />
      <input id={inputId} value={input} maxLength={120} autoComplete="off" disabled={disabled}
        placeholder={t("appearance.songSearch")} aria-label={t("appearance.songSearch")} onChange={(event) => setInput(event.currentTarget.value)} />
    </label>
    {search.length >= 2 && <ul className="profile-song-results">
      {results.isFetching && !tracks.length && <li className="profile-song-empty">{t("listen.queueSearching")}</li>}
      {tracks.map((track) => <li key={track.uri}>
        <button type="button" disabled={disabled} aria-pressed={track.uri === value?.uri} onClick={() => { onChange(track); setInput(""); }}>
          <TrackLine track={track} />
        </button>
      </li>)}
    </ul>}
  </div>;
}

function TrackLine({ track }: { track: SharedTrack }) {
  const title = track.title || t("listen.untitledTrack");
  return <span className="profile-song-line">
    <span className="profile-song-line-art">{track.coverUri ? <AlbumArt title={title} image={track.coverUri} size="tiny" /> : <Music2 size={14} aria-hidden="true" />}</span>
    <span><strong>{title}</strong><small>{track.artists?.join(", ") || t("listen.unknownArtist")}</small></span>
  </span>;
}
