import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { desktopApi } from "../../services/desktopApi";
import { applyThemeMode, rememberThemeMode } from "../../themes/theme";

export function ThemeSync() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings });
  useEffect(() => {
    if (!settings.data) return;
    applyThemeMode(rememberThemeMode(settings.data.theme));
  }, [settings.data?.theme]);
  return null;
}
