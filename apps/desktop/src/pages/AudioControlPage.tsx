import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AudioControlOptions } from "../features/audio-control/AudioControlOptions";
import { AudioVolumeCard, type DspSaveState } from "../features/audio-control/AudioVolumeCard";
import { EqualizerPanel } from "../features/audio-control/EqualizerPanel";
import { SpatialAudioPanel } from "../features/audio-control/SpatialAudioPanel";
import { VolumeBoostPanel } from "../features/audio-control/VolumeBoostPanel";
import { DEFAULT_AUDIO_CONTROL_SETTINGS, setRuntimeAudioControlSettings } from "../features/audio-control/audioControl";
import { VolumeDiagnosticsDetails } from "../features/audio-control/VolumeDiagnosticsDetails";
import { t } from "../i18n";
import { desktopApi } from "../services/desktopApi";
import type { AudioControlSettings } from "../types/tauri";

export function AudioControlPage() {
  const client = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: desktopApi.settings });
  const [settings, setSettings] = useState<AudioControlSettings>(DEFAULT_AUDIO_CONTROL_SETTINGS);
  const [dspAuditionBypassed, setDspAuditionBypassed] = useState(false);
  const [dspSaveState, setDspSaveState] = useState<DspSaveState>("saved");
  const persistedSettings = useRef<AudioControlSettings | null>(null);
  const pendingDspPreview = useRef(DEFAULT_AUDIO_CONTROL_SETTINGS.dsp);
  const dspPreviewTimer = useRef<number | null>(null);
  const lastDspPreviewAt = useRef(0);
  const dspDraft = useRef(DEFAULT_AUDIO_CONTROL_SETTINGS.dsp);
  const dspWasEdited = useRef(false);
  const dspSaveTimer = useRef<number | null>(null);
  const dspSaveChain = useRef<Promise<void>>(Promise.resolve());
  const dspAuditionBypassedRef = useRef(false);
  const audioModuleEnabledRef = useRef(settings.enabled);

  useEffect(() => {
    if (!settingsQuery.data) return;
    const incoming = settingsQuery.data.audioControl;
    if (dspWasEdited.current) {
      setSettings((current) => ({ ...incoming, dsp: current.dsp }));
      persistedSettings.current = { ...incoming, dsp: dspDraft.current };
      return;
    }
    setSettings(incoming);
    persistedSettings.current = incoming;
    dspDraft.current = incoming.dsp;
  }, [settingsQuery.data]);

  useEffect(() => {
    dspAuditionBypassedRef.current = dspAuditionBypassed;
    audioModuleEnabledRef.current = settings.enabled;
  }, [dspAuditionBypassed, settings.enabled]);

  useEffect(() => {
    if (!settingsQuery.isSuccess) return;
    pendingDspPreview.current = {
      ...settings.dsp,
      enabled: !dspAuditionBypassed && settings.enabled && settings.dsp.enabled,
      volumeBoostEnabled: !dspAuditionBypassed && settings.enabled && settings.dsp.volumeBoostEnabled,
      spatial: {
        ...settings.dsp.spatial,
        enabled: !dspAuditionBypassed && settings.enabled && settings.dsp.spatial.enabled,
      },
    };
    if (dspPreviewTimer.current !== null) return;
    const elapsed = performance.now() - lastDspPreviewAt.current;
    dspPreviewTimer.current = window.setTimeout(() => {
      dspPreviewTimer.current = null;
      lastDspPreviewAt.current = performance.now();
      void desktopApi.previewDspSettings(pendingDspPreview.current);
    }, Math.max(0, 45 - elapsed));
  }, [dspAuditionBypassed, settings.dsp, settings.enabled, settingsQuery.isSuccess]);

  useEffect(() => () => {
    if (dspPreviewTimer.current !== null) {
      window.clearTimeout(dspPreviewTimer.current);
      dspPreviewTimer.current = null;
    }
    if (dspSaveTimer.current !== null) window.clearTimeout(dspSaveTimer.current);
    if (dspAuditionBypassedRef.current) {
      const draft = dspDraft.current;
      void desktopApi.previewDspSettings({
        ...draft,
        enabled: audioModuleEnabledRef.current && draft.enabled,
        volumeBoostEnabled: audioModuleEnabledRef.current && draft.volumeBoostEnabled,
        spatial: {
          ...draft.spatial,
          enabled: audioModuleEnabledRef.current && draft.spatial.enabled,
        },
      });
    }
    if (dspWasEdited.current) {
      const settingsToSave = dspDraft.current;
      client.setQueryData(["settings"], (current: typeof settingsQuery.data) => current
        ? { ...current, audioControl: { ...current.audioControl, dsp: settingsToSave } }
        : current);
      dspSaveChain.current = dspSaveChain.current
        .catch(() => undefined)
        .then(() => desktopApi.saveDspSettings(settingsToSave));
    }
  }, []);

  const updateDsp = (dsp: AudioControlSettings["dsp"]) => {
    if (!dsp.enabled && !dsp.spatial.enabled && !dsp.volumeBoostEnabled) setDspAuditionBypassed(false);
    dspDraft.current = dsp;
    dspWasEdited.current = true;
    setDspSaveState("saving");
    setSettings((current) => ({ ...current, dsp }));
    if (dspSaveTimer.current !== null) window.clearTimeout(dspSaveTimer.current);
    dspSaveTimer.current = window.setTimeout(() => {
      dspSaveTimer.current = null;
      const settingsToSave = dspDraft.current;
      dspSaveChain.current = dspSaveChain.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await desktopApi.saveDspSettings(settingsToSave);
            if (dspDraft.current !== settingsToSave) return;
            dspWasEdited.current = false;
            setDspSaveState("saved");
            persistedSettings.current = persistedSettings.current
              ? { ...persistedSettings.current, dsp: settingsToSave }
              : persistedSettings.current;
            client.setQueryData(["settings"], (current: typeof settingsQuery.data) => current
              ? { ...current, audioControl: { ...current.audioControl, dsp: settingsToSave } }
              : current);
          } catch {
            if (dspDraft.current === settingsToSave) setDspSaveState("error");
          }
        });
    }, 360);
  };

  const save = useMutation({
    mutationFn: async () => {
      const current = settingsQuery.data ?? await desktopApi.settings();
      const saved = { ...current, audioControl: settings };
      await desktopApi.saveSettings(saved);
      return saved;
    },
    onSuccess: async (saved) => {
      if (dspSaveTimer.current !== null) {
        window.clearTimeout(dspSaveTimer.current);
        dspSaveTimer.current = null;
      }
      dspDraft.current = saved.audioControl.dsp;
      dspWasEdited.current = false;
      setDspSaveState("saved");
      persistedSettings.current = saved.audioControl;
      setRuntimeAudioControlSettings(saved.audioControl);
      client.setQueryData(["settings"], saved);
      await client.invalidateQueries({ queryKey: ["modules"] });
    },
  });

  const activeDspModules = Number(settings.dsp.enabled)
    + Number(settings.dsp.spatial.enabled)
    + Number(settings.dsp.volumeBoostEnabled && settings.dsp.volumeBoostDb > 0);

  return (
    <div className="page audio-control-page">
      <div className="page-heading split">
        <div><span className="eyebrow">{t("audio.page.eyebrow")}</span><h1>{t("audio.page.title")}</h1></div>
        <label className="audio-master-toggle">
          <span>{t(settings.enabled ? "audio.page.active" : "audio.page.inactive")}</span>
          <span className="switch">
            <input
              type="checkbox"
              aria-label={t("audio.page.moduleToggle")}
              checked={settings.enabled}
              onChange={(event) => {
                const enabled = event.currentTarget.checked;
                setSettings((value) => ({ ...value, enabled }));
              }}
            />
            <span />
          </span>
        </label>
      </div>

      <AudioVolumeCard
        settings={settings}
        activeStages={activeDspModules}
        saveState={dspSaveState}
        bypassed={dspAuditionBypassed}
        onBypassChange={setDspAuditionBypassed}
      />

      <VolumeBoostPanel
        settings={settings.dsp}
        moduleEnabled={settings.enabled}
        onChange={updateDsp}
      />

      <EqualizerPanel
        settings={settings.dsp}
        moduleEnabled={settings.enabled}
        onChange={updateDsp}
      />

      <SpatialAudioPanel
        settings={settings.dsp.spatial}
        moduleEnabled={settings.enabled}
        auditionBypassed={dspAuditionBypassed}
        onChange={(spatial) => {
          setDspAuditionBypassed(false);
          updateDsp({ ...settings.dsp, spatial });
        }}
      />

      {settings.enabled && (
        <>
          <AudioControlOptions settings={settings} onChange={setSettings} />
          <VolumeDiagnosticsDetails />
        </>
      )}

      <div className="audio-save-row">
        <button type="button" className="primary-button" disabled={save.isPending} onClick={() => save.mutate()}>
          <Save size={16} />
          {save.isPending ? t("audio.page.saving") : save.isSuccess ? t("audio.page.saved") : t("audio.page.save")}
        </button>
        <small>{t("audio.page.autoSaveNote")}</small>
      </div>
    </div>
  );
}
