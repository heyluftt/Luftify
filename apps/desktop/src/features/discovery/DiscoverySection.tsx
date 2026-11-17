import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { DiscoveryTrack } from "./DiscoveryTrack";
import { t } from "../../i18n";
import { playbackCommands } from "../playback/playbackCommands";
import { usePlayerStore } from "../../stores/playerStore";
import { usePlaybackEngine } from "../playback/usePlaybackEngine";
import { discoveryQuery } from "./discoveryQuery";
import { MixShelf } from "./MixShelf";
import { MixUndoNotice } from "./MixUndoNotice";
import { replacementCandidate, useMixLibrary, type SavedMix } from "./mixLibrary";
import { mixContextUri, mixTitle } from "./mixPresentation";
import "../../styles/components/discovery.css";

const DISCOVERY_CONTEXT_PREFIX = "spotify:search:luftify-discovery-";

export const DiscoverySection = memo(function DiscoverySection({ analyticsEnabled }: { analyticsEnabled: boolean }) {
  const { localReady } = usePlaybackEngine();
  const currentUri = usePlayerStore((store) => store.playback?.currentItem?.uri);
  const isSaved = usePlayerStore((store) => store.playback?.isSaved);
  const playingContext = usePlayerStore((store) => store.playback?.contextUri);
  const isPlaying = usePlayerStore((store) => !!store.playback?.isPlaying);
  const { playContext, playUri } = playbackCommands;
  const client = useQueryClient();
  const result = useQuery({ ...discoveryQuery(client), enabled: false });
  const { mixes, storageError, ready: libraryReady, remove, restore } = useMixLibrary();
  const [selected, setSelected] = useState<string>();
  const [previewReplace, setPreviewReplace] = useState(false);
  const [removed, setRemoved] = useState<SavedMix>();
  const dismissRemoved = useCallback(() => setRemoved(undefined), []);
  const opened = mixes.find((mix) => mix.id === selected);
  const picks = opened?.picks ?? [];
  const tracks = picks.map((pick) => pick.track);
  const ready = localReady && analyticsEnabled && libraryReady;
  const replacing = replacementCandidate(mixes);
  const mixId = playingContext?.startsWith(DISCOVERY_CONTEXT_PREFIX)
    ? playingContext.slice(DISCOVERY_CONTEXT_PREFIX.length)
    : undefined;

  const generate = () => {
    setPreviewReplace(false);
    void result.refetch().then(({ data }) => {
      // Open the fresh mix; add() may have skipped an identical duplicate.
      const newest = useMixLibrary.getState().mixes[0];
      if (data?.picks.length && newest) setSelected(newest.id);
    });
  };

  return <section className="section-block discovery-section" aria-label={t("discovery.collection")}>
    <div className="section-title"><h2>{t("discovery.collection")}</h2>
      <div className="discovery-actions">
        <button className="secondary-button discovery-generate" type="button" disabled={!ready || result.isFetching}
          title={replacing ? t("discovery.replaceHint", { title: mixTitle(replacing) }) : undefined}
          onPointerEnter={() => setPreviewReplace(true)} onPointerLeave={() => setPreviewReplace(false)}
          onFocus={() => setPreviewReplace(true)} onBlur={() => setPreviewReplace(false)}
          onClick={generate}>
          <Sparkles size={15} aria-hidden="true" />
          {t(result.isFetching ? "discovery.loading" : "discovery.regenerate")}
        </button>
      </div>
    </div>
    {(!analyticsEnabled || !localReady) && <p className="discovery-note">{t(!analyticsEnabled ? "discovery.analytics" : "discovery.libre")}</p>}
    <div role="status" aria-live="polite">
      {storageError && <p>{t("discovery.storageError")}</p>}
      {result.isError && <p>{t("discovery.error")}</p>}
      {result.data && !result.data.picks.length && <p>{t(result.data.noProfile ? "discovery.noProfile" : "discovery.empty")}</p>}
    </div>
    {ready && !mixes.length && !result.isFetching && !result.data && <p className="discovery-note">{t("discovery.firstMix")}</p>}
    <MixShelf selected={selected} onSelect={(id) => setSelected(selected === id ? undefined : id)}
      generating={result.isFetching}
      replacingId={replacing?.id} previewReplace={previewReplace && ready}
      canPlay={localReady}
      playback={{
        ...(mixId ? { mixId } : {}),
        playing: isPlaying,
        play: (mix) => playUri(mixContextUri(mix), mix.picks.map(({ track }) => track)),
        pause: () => playbackCommands.send({ command: "pause" }),
      }}
      onRemove={(mix) => {
        if (!remove(mix.id)) return;
        if (selected === mix.id) setSelected(undefined);
        setRemoved(mix);
      }} />
    {removed && <MixUndoNotice title={mixTitle(removed)} onDismiss={dismissRemoved}
      onUndo={() => { restore(removed); setRemoved(undefined); }} />}
    {opened && <div className="mix-detail-heading">
      <strong className="mix-detail-title">{mixTitle(opened)}</strong>
      <span>{t("discovery.count", { count: picks.length })}</span>
      <button type="button" className="ghost-button" onClick={() => setSelected(undefined)}>{t("discovery.closeMix")}</button>
    </div>}
    {!!picks.length && opened && <ol className="discovery-tracks" aria-busy={result.isFetching}>{picks.map((pick) =>
      <DiscoveryTrack key={pick.track.uri} {...pick} disabled={!localReady}
        current={currentUri === pick.track.uri}
        saved={currentUri === pick.track.uri && !!isSaved}
        onPlay={() => playContext(mixContextUri(opened), pick.track.uri, tracks)} />)}</ol>}
  </section>;
});
