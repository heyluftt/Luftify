import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Copy, Download, ListMusic, RotateCcw } from "lucide-react";
import { useState, type MouseEvent } from "react";
import { t } from "../../i18n";
import { desktopApi } from "../../services/desktopApi";
import type { CoverPalette } from "../theme/coverPalette";
import { RecapPoster } from "./RecapPoster";
import { blobToBase64, renderRecapImage } from "./recapShareImage";
import { SlideFrame, delay, type RecapSlideProps } from "./RecapSlides";

export function SummarySlide(props: RecapSlideProps & {
  palette: CoverPalette;
  coverData: string | undefined;
  onPlayTop: () => void;
  onReplay: () => void;
  /** The next new recap, if one waits. */
  next?: { title: string; open: () => void };
}) {
  const { recap, period, facts } = props;
  const [copied, setCopied] = useState(false);
  const image = () => renderRecapImage({
    recap,
    period,
    facts,
    palette: props.palette,
    ...(props.coverData ? { coverData: props.coverData } : {}),
  });
  const save = useMutation({
    mutationFn: async () => desktopApi.saveRecapImage(await blobToBase64(await image()), `Luftify Rückblick ${period.title}`),
  });
  const copy = useMutation({
    mutationFn: async () => {
      const blob = await image();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    },
    onSuccess: () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    },
  });
  const stop = (action: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    action();
  };
  const status = save.isSuccess ? t("recap.summary.saved", { path: save.data })
    : save.isError || copy.isError ? t("recap.summary.error")
    : copied ? t("recap.summary.copied") : "";

  return (
    <SlideFrame eyebrow={t("recap.summary.lead")} className="recap-summary">
      <div className="recap-enter recap-pop" style={delay(120)}>
        <RecapPoster recap={recap} period={period} facts={facts} coverData={props.coverData} />
      </div>
      <div className="recap-summary-actions recap-enter" style={delay(420)}>
        <button type="button" className="recap-action is-primary" disabled={save.isPending} onClick={stop(() => save.mutate())}>
          <Download size={15} aria-hidden="true" />{t("recap.summary.save")}
        </button>
        <button type="button" className="recap-action" disabled={copy.isPending} onClick={stop(() => copy.mutate())}>
          <Copy size={15} aria-hidden="true" />{t("recap.summary.copy")}
        </button>
        <button type="button" className="recap-action" disabled={recap.overview.topTracks.length === 0} onClick={stop(props.onPlayTop)}>
          <ListMusic size={15} aria-hidden="true" />{t("recap.summary.playTop")}
        </button>
        <button type="button" className="recap-action" onClick={stop(props.onReplay)}>
          <RotateCcw size={15} aria-hidden="true" />{t("recap.summary.replay")}
        </button>
      </div>
      {props.next && <button type="button" className="recap-next recap-enter" style={delay(560)} onClick={stop(props.next.open)}>
        <small>{t("recap.summary.next")}</small><span>{props.next.title}</span><ArrowRight size={15} aria-hidden="true" />
      </button>}
      <p className="recap-summary-status" role="status">{status}</p>
    </SlideFrame>
  );
}
