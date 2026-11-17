import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, Blocks, ChevronRight, MicVocal, type LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { t } from "../i18n";
import { desktopApi } from "../services/desktopApi";

const MODULE_ICONS: Record<string, LucideIcon> = {
  "audio-control": AudioLines,
  lyrics: MicVocal,
};

export function ModulesPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const modules = useQuery({ queryKey: ["modules"], queryFn: desktopApi.modules, retry: false });
  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const settings = await desktopApi.settings();
      if (id === "audio-control") {
        await desktopApi.saveSettings({ ...settings, audioControl: { ...settings.audioControl, enabled } });
      } else if (id === "lyrics") {
        await desktopApi.saveSettings({ ...settings, lyricsEnabled: enabled });
      }
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["modules"] }),
        client.invalidateQueries({ queryKey: ["settings"] }),
      ]);
    },
  });
  const items = modules.data ?? [];

  return (
    <div className="page modules-page">
      <div className="page-heading"><h1>{t("modules.title")}</h1></div>
      <section className="section-block">
        <div className="section-title"><h2>{t("modules.installed")}</h2></div>
        {modules.isSuccess && items.length === 0 && <p className="empty-inline">{t("modules.empty")}</p>}
        <div className="module-grid">
          {items.map((module) => {
            const Icon = MODULE_ICONS[module.manifest.id] ?? Blocks;
            const state = !module.available ? "unavailable" : module.enabled ? "active" : "inactive";
            return (
              <article className="module-card" key={module.manifest.id}>
                <button type="button" className="module-card-main" onClick={() => navigate(`/modules/${module.manifest.id}`)}>
                  <span className="module-icon"><Icon /></span>
                  <span className="module-card-copy">
                    <strong>{module.manifest.name}</strong>
                    <small>{module.manifest.description}</small>
                    <span className={`module-card-state is-${state}`}>{t(`modules.${state}`)}</span>
                  </span>
                  <ChevronRight size={18} />
                </button>
                <label className="switch" aria-label={t("modules.toggle", { name: module.manifest.name })}>
                  <input
                    type="checkbox"
                    checked={module.enabled}
                    disabled={toggle.isPending}
                    onChange={(event) => toggle.mutate({ id: module.manifest.id, enabled: event.currentTarget.checked })}
                  />
                  <span />
                </label>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
