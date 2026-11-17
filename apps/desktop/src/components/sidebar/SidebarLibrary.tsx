import type { EntitySummary } from "@luft/protocol-types";
import { Heart, Library, Search, Volume2, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { t, type MessageKey } from "../../i18n";
import { usePlaylistUsage } from "../../features/home/usePlaylistUsage";
import {
  LIKED_COLLECTION_URI,
  filterPlaylists,
  formatTrackCount,
  playlistOwnerGroup,
  sortPlaylists,
  type PlaylistOwnerGroup,
} from "../../features/library/libraryPresentation";
import { useLikedTrackUris, usePlaylistLibrary } from "../../features/library/libraryQueries";
import { usePlayerStore } from "../../stores/playerStore";
import { AlbumArt } from "../AlbumArt";

type Scope = "all" | PlaylistOwnerGroup;

const SCOPES: { id: Scope; label: MessageKey }[] = [
  { id: "all", label: "libraryUi.ownerAll" },
  { id: "mine", label: "libraryUi.ownerMine" },
  { id: "spotify", label: "libraryUi.ownerSpotify" },
];

const SCOPE_KEY = "luftify.sidebar.scope.v1";

function readScope(): Scope {
  try {
    const value = window.localStorage.getItem(SCOPE_KEY);
    return value === "mine" || value === "spotify" ? value : "all";
  } catch {
    return "all";
  }
}

function playlistPath(uri: string) {
  return `/playlist/${encodeURIComponent(uri)}`;
}

/**
 * The listener's library right in the sidebar: liked songs and playlists,
 * most used first, narrowed by owner or a quick text filter.
 */
export function SidebarLibrary({ collapsed }: { collapsed: boolean }) {
  const playlists = usePlaylistLibrary();
  const usage = usePlaylistUsage();
  const likedUris = useLikedTrackUris();
  const contextUri = usePlayerStore((store) => store.playback?.contextUri);
  const [scope, setScopeState] = useState<Scope>(readScope);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);

  const setScope = (next: Scope) => {
    setScopeState(next);
    try {
      window.localStorage.setItem(SCOPE_KEY, next);
    } catch {
      // Only a convenience: the next start shows all playlists again.
    }
  };

  const items = useMemo(() => {
    const all = playlists.view.data?.items ?? [];
    const scoped = scope === "all" ? all : all.filter((item) => playlistOwnerGroup(item) === scope);
    return sortPlaylists(filterPlaylists(scoped, query), "smart", usage.data ?? []);
  }, [playlists.view.data?.items, query, scope, usage.data]);

  const likedCount = likedUris.data?.length;
  const showLiked = scope !== "spotify" && (!query || t("library.liked").toLowerCase().includes(query.toLowerCase()));

  return (
    <section className="sidebar-library" aria-label={t("library.yours")}>
      <header className="sidebar-library-head">
        <NavLink to="/library" end className={({ isActive }) => (isActive ? "sidebar-library-title active" : "sidebar-library-title")} title={t("library.open")}>
          <Library size={20} strokeWidth={1.9} aria-hidden="true" />
          <span>{t("library.title")}</span>
        </NavLink>
        {!collapsed && (
          <button
            type="button"
            className={searching ? "sidebar-icon-button active" : "sidebar-icon-button"}
            aria-label={t("libraryUi.filterPlaylists")}
            title={t("libraryUi.filterPlaylists")}
            aria-pressed={searching}
            onClick={() => {
              setSearching((value) => !value);
              setQuery("");
            }}
          >
            <Search size={16} />
          </button>
        )}
      </header>

      {!collapsed && (
        <div className="sidebar-library-tools">
          {searching ? (
            <label className="sidebar-library-search">
              <Search size={14} aria-hidden="true" />
              <input
                autoFocus
                type="search"
                value={query}
                placeholder={t("libraryUi.filterPlaylists")}
                aria-label={t("libraryUi.filterPlaylists")}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setQuery("");
                    setSearching(false);
                  }
                }}
              />
              {query && (
                <button type="button" aria-label={t("search.clear")} onClick={() => setQuery("")}>
                  <X size={13} />
                </button>
              )}
            </label>
          ) : (
            <div className="sidebar-library-scopes" role="group" aria-label={t("libraryUi.ownerFilter")}>
              {SCOPES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={scope === entry.id ? "ds-chip is-active" : "ds-chip"}
                  aria-pressed={scope === entry.id}
                  onClick={() => setScope(entry.id)}
                >
                  {t(entry.label)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ul className="sidebar-library-list">
        {showLiked && (
          <li>
            <LibraryEntry
              to="/liked"
              title={t("library.liked")}
              detail={likedCount === undefined ? t("search.kind.playlist") : formatTrackCount(likedCount)}
              playing={contextUri === LIKED_COLLECTION_URI}
              collapsed={collapsed}
              art={<span className="sidebar-liked-art" aria-hidden="true"><Heart size={collapsed ? 17 : 15} fill="currentColor" /></span>}
            />
          </li>
        )}
        {items.map((item) => (
          <li key={item.uri}>
            <LibraryEntry
              to={playlistPath(item.uri)}
              state={item}
              title={item.name}
              detail={entryDetail(item)}
              playing={contextUri === item.uri}
              collapsed={collapsed}
              art={<AlbumArt title={item.name} image={item.coverUri} size="tiny" />}
            />
          </li>
        ))}
        {!collapsed && query && items.length === 0 && !showLiked && (
          <li className="sidebar-library-empty">{t("libraryUi.noMatch", { query })}</li>
        )}
      </ul>
    </section>
  );
}

function entryDetail(item: EntitySummary): string {
  const owner = playlistOwnerGroup(item) === "spotify" ? "Spotify" : item.subtitle && item.subtitle !== "Playlist" ? item.subtitle : undefined;
  const kind = t("search.kind.playlist");
  return owner ? `${kind} · ${owner}` : kind;
}

function LibraryEntry({ to, state, title, detail, playing, collapsed, art }: {
  to: string;
  state?: EntitySummary;
  title: string;
  detail: string;
  playing: boolean;
  collapsed: boolean;
  art: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      state={state}
      title={collapsed ? title : undefined}
      aria-label={playing ? `${title} – ${t("shell.nowPlaying")}` : title}
      className={({ isActive }) => ["sidebar-entry", isActive ? "active" : "", playing ? "is-playing" : ""].filter(Boolean).join(" ")}
    >
      {art}
      {!collapsed && (
        <span className="sidebar-entry-copy">
          <strong>{title}</strong>
          <small>{detail}</small>
        </span>
      )}
      {!collapsed && playing && <Volume2 className="sidebar-entry-playing" size={15} aria-hidden="true" />}
    </NavLink>
  );
}
