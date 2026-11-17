import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { desktopApi } from "../../services/desktopApi";
import { buildRecapCatalog } from "./recapPeriods";
import { seenRecaps } from "./recapSeen";
import type { RecapPeriod, RecapPreview } from "./recapTypes";

function timezoneOffsetMinutes() {
  return -new Date().getTimezoneOffset();
}

/** Every recap on offer, and the fresh ones not watched yet. */
export function useRecapCatalog(enabled = true) {
  const settings = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings, staleTime: 30_000 });
  const analyticsOn = settings.data?.listeningAnalyticsEnabled ?? true;
  const offset = timezoneOffsetMinutes();
  const days = useQuery({
    queryKey: ["recap", "days", offset],
    queryFn: () => desktopApi.listeningDays(offset),
    enabled: enabled && analyticsOn,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  const [seenVersion, setSeenVersion] = useState(0);
  useEffect(() => {
    const onSeen = () => setSeenVersion((value) => value + 1);
    window.addEventListener("luftify:recaps-seen", onSeen);
    return () => window.removeEventListener("luftify:recaps-seen", onSeen);
  }, []);
  const periods = useMemo(() => (days.data ? buildRecapCatalog(days.data) : []), [days.data]);
  // seenVersion re-reads the storage after a recap was watched.
  const seen = useMemo(() => seenRecaps(), [seenVersion]);
  const fresh = useMemo(() => periods.filter((period) => period.fresh && !seen.has(period.id)), [periods, seen]);
  return { periods, fresh, seen, query: days, days: days.data, enabled: analyticsOn };
}

/** Covers, top song and top artist for each card, fetched in one go. */
export function useRecapPreviews(periods: RecapPeriod[]) {
  const ranges = useMemo(
    () => periods.map((period) => ({ id: period.id, fromUnixMs: period.fromMs, toUnixMs: period.toMs })),
    [periods],
  );
  const query = useQuery({
    queryKey: ["recap", "previews", ranges.map((range) => `${range.id}@${range.toUnixMs}`).join("|")],
    queryFn: () => desktopApi.recapPreviews(ranges),
    enabled: ranges.length > 0,
    staleTime: 10 * 60_000,
    retry: 1,
  });
  return useMemo(
    () => new Map<string, RecapPreview>((query.data ?? []).map((preview) => [preview.id, preview])),
    [query.data],
  );
}

export function useRecap(period: RecapPeriod | undefined) {
  return useQuery({
    queryKey: ["recap", "detail", period?.id, period?.toMs],
    queryFn: () => desktopApi.listeningRecap({
      fromUnixMs: period!.fromMs,
      toUnixMs: period!.toMs,
      previousFromUnixMs: period!.previousFromMs ?? null,
      timezoneOffsetMinutes: timezoneOffsetMinutes(),
    }),
    enabled: Boolean(period),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** A cover as a data URL: usable for colours and the share image. */
export function useCoverData(coverUri: string | null | undefined) {
  const remote = coverUri?.startsWith("https://") ? coverUri : undefined;
  const query = useQuery({
    queryKey: ["cover", remote],
    queryFn: () => desktopApi.coverData(remote!),
    enabled: Boolean(remote),
    staleTime: Infinity,
    retry: false,
  });
  if (coverUri?.startsWith("data:image/")) return coverUri;
  return query.data ?? undefined;
}
