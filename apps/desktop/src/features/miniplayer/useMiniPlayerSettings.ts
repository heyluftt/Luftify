import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { desktopApi } from "../../services/desktopApi";
import type { MiniPlayerSettings, Settings } from "../../types/tauri";
import { DEFAULT_MINIPLAYER_SETTINGS } from "./miniplayerSettings";

export function useMiniPlayerSettings() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings, staleTime: 30_000 });
  const [draft, setDraft] = useState<MiniPlayerSettings>(DEFAULT_MINIPLAYER_SETTINGS);
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const settings = query.data;
  const save = useMutation({
    mutationFn: desktopApi.saveMiniplayerSettings,
    onSuccess: (saved) => {
      client.setQueryData<Settings>(["settings"], (current) => current
        ? { ...current, miniplayer: saved }
        : current);
      if (samePreferences(draftRef.current, saved)) {
        dirtyRef.current = false;
        draftRef.current = saved;
        setDraft(saved);
        return;
      }
      setDraft((current) => {
        const next = {
          ...current,
          positionX: saved.positionX,
          positionY: saved.positionY,
        };
        draftRef.current = next;
        return next;
      });
    },
    onError: () => {
      dirtyRef.current = false;
      const saved = client.getQueryData<Settings>(["settings"])?.miniplayer;
      if (saved) {
        draftRef.current = saved;
        setDraft(saved);
      }
      void client.invalidateQueries({ queryKey: ["settings"] });
    },
  });
  const { mutate, isPending } = save;
  useEffect(() => {
    if (!settings || dirtyRef.current || save.isPending) return;
    draftRef.current = settings.miniplayer;
    setDraft(settings.miniplayer);
  }, [save.isPending, settings]);
  useEffect(() => {
    if (!settings || isPending || !dirtyRef.current) return;
    if (samePreferences(draft, settings.miniplayer)) {
      dirtyRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => mutate(draft), 160);
    return () => window.clearTimeout(timer);
  }, [draft, mutate, isPending, settings]);
  const update = useCallback((patch: Partial<MiniPlayerSettings>) => {
    setDraft((current) => {
      const next = { ...current, ...patch };
      draftRef.current = next;
      dirtyRef.current = true;
      return next;
    });
  }, []);

  return {
    settings: draft,
    ready: Boolean(settings),
    saving: save.isPending,
    update,
  };
}

function samePreferences(first: MiniPlayerSettings, second: MiniPlayerSettings): boolean {
  return first.scale === second.scale
    && first.opacityPercent === second.opacityPercent
    && first.alwaysOnTop === second.alwaysOnTop
    && first.clickThrough === second.clickThrough;
}
