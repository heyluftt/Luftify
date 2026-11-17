import type { EntitySummary } from "@luft/protocol-types";
import { Check, ListMusic, LoaderCircle, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterPickerPlaylists,
  initialPlaylistPickerItems,
  playlistsContainingTrack,
  rememberPlaylistPickerItems,
  streamPlaylistPages,
} from "./playlistPicker";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { desktopApi } from "../../services/desktopApi";
import { sortPlaylists } from "../../features/library/libraryPresentation";
import { t } from "../../i18n";
import { canonicalPlaylistUri } from "../../features/entities/playlistSnapshot";

interface AddToPlaylistPickerProps {
  queryClient: QueryClient;
  trackUri: string;
  /** Set while asking whether to add a title that is already in the playlist. */
  duplicate: EntitySummary | undefined;
  onConfirmDuplicate: (playlist: EntitySummary) => void;
  onCancelDuplicate: () => void;
  verifiedOnly: boolean;
  pendingPlaylistUri: string | undefined;
  onBack: () => void;
  onSelect: (playlist: EntitySummary) => void;
}

export function AddToPlaylistPicker({
  queryClient,
  trackUri,
  duplicate,
  onConfirmDuplicate,
  onCancelDuplicate,
  verifiedOnly,
  pendingPlaylistUri,
  onBack,
  onSelect,
}: AddToPlaylistPickerProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [playlists, setPlaylists] = useState<EntitySummary[]>(() =>
    verifiedOnly ? [] : initialPlaylistPickerItems(queryClient),
  );
  const [query, setQuery] = useState("");
  const [loadingPlaylists, setLoadingPlaylists] = useState(playlists.length === 0);
  const [loadError, setLoadError] = useState<string>();

  const usage = useQuery({
    queryKey: ["playlist-usage"],
    queryFn: desktopApi.playlistUsage,
    staleTime: 30_000,
    retry: false,
  });
  const containing = useMemo(
    () => playlistsContainingTrack(queryClient, trackUri),
    [queryClient, trackUri],
  );
  const filteredPlaylists = useMemo(
    () => filterPickerPlaylists(sortPlaylists(playlists, "most-played", usage.data ?? []), query),
    [playlists, query, usage.data],
  );

  useEffect(() => {
    let disposed = false;
    let collected = verifiedOnly ? [] : initialPlaylistPickerItems(queryClient);
    setPlaylists(collected);
    const seeded = collected.length > 0;
    let firstPageVisible = seeded;
    setLoadingPlaylists(!firstPageVisible);
    setLoadError(undefined);
    if (firstPageVisible) {
      window.requestAnimationFrame(() => searchRef.current?.focus());
    }

    const publish = (items: EntitySummary[]) => {
      if (disposed || items.length === 0) return;
      collected = rememberPlaylistPickerItems([...collected, ...items], verifiedOnly);
      setPlaylists(collected);
      if (!firstPageVisible && collected.length > 0) {
        firstPageVisible = true;
        setLoadingPlaylists(false);
        window.requestAnimationFrame(() => searchRef.current?.focus());
      }
    };

    void streamPlaylistPages(publish, verifiedOnly, () => disposed)
      .catch(() => {
        if (disposed) return;
        if (!seeded) {
          setLoadError(t("playlistPicker.error"));
        }
      })
      .finally(() => {
        if (!disposed) setLoadingPlaylists(false);
      });

    return () => {
      disposed = true;
    };
  }, [queryClient, verifiedOnly]);

  return (
    <div className="track-playlist-picker">
      <button type="button" className="track-actions-back" onClick={onBack}>
        {t("playlistPicker.back")}
      </button>

      <label className="track-playlist-search">
        <Search size={15} />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("playlistPicker.search")}
          aria-label={t("playlistPicker.search")}
        />
      </label>

      <p className="track-playlist-sort-hint">{t("playlistPicker.hint")}</p>
      {duplicate && (
        <div className="track-playlist-duplicate" role="alert">
          <span>{t("playlistPicker.duplicate", { name: duplicate.name })}</span>
          <div>
            <button type="button" className="text-button" onClick={onCancelDuplicate}>
              {t("playlistPicker.cancel")}
            </button>
            <button type="button" className="secondary-button" onClick={() => onConfirmDuplicate(duplicate)}>
              {t("playlistPicker.addAnyway")}
            </button>
          </div>
        </div>
      )}
      <div className="track-playlist-results" aria-busy={loadingPlaylists}>
        {loadingPlaylists ? (
          <p className="track-actions-loading">
            <LoaderCircle size={16} className="spin" />
            {t("playlistPicker.loading")}
          </p>
        ) : loadError ? (
          <p className="track-actions-hint">{loadError}</p>
        ) : filteredPlaylists.length === 0 ? (
          <p className="track-actions-hint">{t(query.trim() ? "playlistPicker.noMatch" : "playlistPicker.empty")}</p>
        ) : (
          filteredPlaylists.map((playlist) => {
            const contained = containing.has(canonicalPlaylistUri(playlist.uri));
            return (
            <button
              type="button"
              key={playlist.uri}
              className={contained ? "is-contained" : undefined}
              disabled={pendingPlaylistUri !== undefined || duplicate !== undefined}
              title={contained ? t("playlistPicker.contains") : undefined}
              onClick={() => onSelect(playlist)}
            >
              <span>
                <strong>{playlist.name}</strong>
                {playlist.subtitle && <small>{playlist.subtitle}</small>}
              </span>
              {pendingPlaylistUri === playlist.uri ? (
                <LoaderCircle size={16} className="spin" />
              ) : contained ? (
                <Check size={16} aria-label={t("playlistPicker.contains")} />
              ) : (
                <ListMusic size={16} />
              )}
            </button>
            );
          })
        )}
      </div>
    </div>
  );
}
