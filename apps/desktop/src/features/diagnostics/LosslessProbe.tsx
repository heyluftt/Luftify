import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Activity, AlertTriangle, AudioWaveform, CheckCircle2 } from "lucide-react";
import { t, type MessageKey } from "../../i18n";
import { usePlayerStore } from "../../stores/playerStore";

type Outcome = "ok" | "refused" | "timeout" | "failed" | "skipped";
interface Step { outcome: Outcome; detail?: string }
interface FileProbe { format: string; storage: Step; key: Step; header: Step }
interface TrackProbe { uri: string; title: string; formats: string[]; extensionFormats?: string[]; lossless?: FileProbe | null; lossless16?: FileProbe | null; reference?: FileProbe | null }
interface Probe { accountType?: string | null; attributes: [string, string][]; tracks: TrackProbe[]; losslessWorks: boolean }

const FLAC_NAMES: Record<string, string> = { FLAC_FLAC_24BIT: "24-bit", FLAC_FLAC: "16-bit" };

/**
 * Lossless, phase 0: whether Spotify hands this account its FLAC files and
 * their keys (lossless_probe.rs). Only on request; nothing is played.
 */
export function LosslessProbe() {
  const current = usePlayerStore((state) => state.playback?.currentItem?.uri);
  const probe = useMutation({
    mutationFn: () => invoke<Probe>("probe_lossless", { uris: current?.startsWith("spotify:track:") ? [current] : [] }),
  });
  const result = probe.data;
  const verdict = !result ? undefined
    : !result.tracks.length ? "lossless.noSongs"
      : result.losslessWorks ? "lossless.works"
        : result.tracks.some((track) => track.lossless) ? "lossless.refused" : "lossless.noFlac";
  const tone = !result ? "neutral" : result.losslessWorks ? "ok" : "warning";
  return (
    <section className="diagnostic-actions lossless-probe" aria-labelledby="lossless-probe-title">
      <div className="diagnostic-section-heading">
        <span className={`diagnostic-section-icon ${tone}`}>{tone === "ok" ? <CheckCircle2 /> : <AudioWaveform />}</span>
        <div>
          <span>{t("lossless.eyebrow")}</span>
          <h2 id="lossless-probe-title">{verdict ? t(verdict) : t("lossless.question")}</h2>
          <p>{result?.accountType ? t("lossless.account", { type: result.accountType }) : t("lossless.hint")}</p>
        </div>
      </div>
      <div className="diagnostic-button-row">
        <button type="button" className="secondary-button" disabled={probe.isPending} onClick={() => probe.mutate()}>
          <Activity size={16} className={probe.isPending ? "is-spinning" : undefined} />
          {probe.isPending ? t("lossless.running") : t("lossless.start")}
        </button>
      </div>
      {probe.isError && <p className="diagnostic-error-copy" role="alert">{errorMessage(probe.error)}</p>}
      {result?.tracks.map((track) => <div key={track.uri} className="lossless-probe-track">
        <strong>{track.title}</strong>
        {/* The song record and the AUDIO_FILES extension may list different files. */}
        <small>{flacSummary([...track.formats, ...(track.extensionFormats ?? []).map((format) => format.split(" ")[0] ?? format)])}</small>
        <div className="diagnostic-install-facts">
          {track.lossless && <>
            <Fact label={t("lossless.storage")} step={track.lossless.storage} />
            <Fact label={t("lossless.key")} step={track.lossless.key} />
            <Fact label={t("lossless.header")} step={track.lossless.header} />
          </>}
          {track.lossless16 && <Fact label={t("lossless.flac16")} step={track.lossless16.header.outcome === "ok" ? track.lossless16.header : worst(track.lossless16)} />}
          {track.reference && <Fact label={t("lossless.reference")} step={track.reference.header.outcome === "ok" ? track.reference.header : worst(track.reference)} />}
        </div>
      </div>)}
    </section>
  );
}

function Fact({ label, step }: { label: string; step: Step }) {
  const ready = step.outcome === "ok" ? true : step.outcome === "skipped" ? undefined : false;
  return <span className={ready === undefined ? "is-pending" : ready ? "is-ready" : "is-missing"} title={step.detail}>
    {ready ? <CheckCircle2 /> : ready === false ? <AlertTriangle /> : <Activity />}
    <small>{label}</small>
    <strong>{t(`lossless.outcome.${step.outcome}` as MessageKey)}</strong>
  </span>;
}

/** The first step that did not work, so the control shows where it stopped. */
function worst(file: FileProbe): Step {
  return [file.storage, file.key, file.header].find((step) => step.outcome !== "ok") ?? file.header;
}

function flacSummary(formats: string[]) {
  const flac = [...new Set(formats.filter((format) => format in FLAC_NAMES).map((format) => FLAC_NAMES[format]))];
  return flac.length ? t("lossless.formats", { formats: flac.join(", ") }) : t("lossless.noFlacFile");
}

function errorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return t("lossless.error");
}
