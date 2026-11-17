import { useQuery } from "@tanstack/react-query";
import { useDeferredValue, useId, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { desktopApi } from "../../services/desktopApi";
import { t } from "../../i18n";
import { matchesEveryWord } from "../textMatch";
import { SharedQueueCollectionRow } from "./SharedQueueCollectionRow";
import type { RoomAddSource } from "./useRoomQueueAdd";

const PAGE_SIZE = 8;

/** The listener's own playlists, from the library cache when possible. */
export function SharedQueueLibrary({ disabled, onAddMany }: { disabled: boolean; onAddMany: (source: RoomAddSource, next: boolean) => void }) {
  const inputId = useId();
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState(0);
  const deferred = useDeferredValue(filter.trim());
  const playlists = useQuery({
    queryKey: ["shared-queue-playlists"],
    queryFn: async () => {
      const request = { offset: 0, limit: 200 };
      return (await desktopApi.cachedPlaylists(request).catch(() => null)) ?? desktopApi.playlists(request);
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
  const items = (playlists.data?.items ?? []).filter((item) => !deferred || matchesEveryWord(deferred, item.name));
  const page = Math.min(cursor, Math.max(0, Math.ceil(items.length / PAGE_SIZE) - 1));
  const start = page * PAGE_SIZE;
  return <div className="shared-queue-library">
    <label className="shared-queue-filter" htmlFor={inputId}><Search size={15} aria-hidden="true" />
      <input id={inputId} value={filter} maxLength={80} placeholder={t("listen.sources.filter")} aria-label={t("listen.sources.filter")}
        autoComplete="off" onChange={(event) => { setFilter(event.currentTarget.value); setCursor(0); }} />
    </label>
    {playlists.isPending && <p role="status">{t("listen.sources.loading")}</p>}
    {playlists.isError && <p role="alert">{t("listen.sources.error")}</p>}
    {playlists.isSuccess && !items.length && <p>{t("listen.sources.empty")}</p>}
    {!!items.length && <ul className="shared-queue-results shared-queue-collections">
      {items.slice(start, start + PAGE_SIZE).map((item) => <SharedQueueCollectionRow key={item.uri} entity={item} disabled={disabled} onAddMany={onAddMany}
        detail={item.library?.trackCount ? t("listen.sources.count", { n: item.library.trackCount }) : undefined} />)}
    </ul>}
    {items.length > PAGE_SIZE && <nav className="shared-queue-library-pages" aria-label={t("listen.sources.pages")}>
      <span>{t("listen.sources.range", { from: start + 1, to: Math.min(start + PAGE_SIZE, items.length), total: items.length })}</span>
      <div><button type="button" className="icon-button" disabled={page === 0} aria-label={t("listen.sources.previous")} onClick={() => setCursor(page - 1)}><ChevronLeft size={17} /></button>
        <button type="button" className="icon-button" disabled={start + PAGE_SIZE >= items.length} aria-label={t("listen.sources.next")} onClick={() => setCursor(page + 1)}><ChevronRight size={17} /></button></div>
    </nav>}
  </div>;
}
