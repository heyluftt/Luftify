import { Play, Sparkles } from "lucide-react";
import { AlbumArt } from "../../../components/AlbumArt";
import { t } from "../../../i18n";
import { RecapCoverMosaic } from "../RecapCovers";
import { formatRecapDate, recapCount } from "../recapFormat";
import { recapKindIcon } from "../recapKindIcon";
import type { RecapPeriod, RecapPreview } from "../recapTypes";
import { monthName, shortTime } from "./recapPageFormat";

interface TileProps {
  period: RecapPeriod;
  preview: RecapPreview | undefined;
  isNew: boolean;
  onOpen: (period: RecapPeriod) => void;
}

export function NewBadge() {
  return <span className="recap-new-badge"><Sparkles size={11} aria-hidden="true" />{t("recap.page.new")}</span>;
}

/** Season, year or milestone: a card with its symbol, in the colours of its cover. */
export function RecapMomentTile({ period, preview, isNew, onOpen }: TileProps) {
  const Icon = recapKindIcon(period);
  const cover = preview?.coverUris[0];
  const season = period.kind === "season" ? period.id.split("-").pop() : undefined;
  const subtitle = period.kind === "milestone"
    ? t("recap.page.reached", { date: formatRecapDate(period.toMs - 1) })
    : preview?.topArtistName ? t("recap.page.mostly", { name: preview.topArtistName }) : period.dates;
  return (
    <button type="button" className="recap-tile recap-moment" data-kind={period.kind} data-season={season} onClick={() => onOpen(period)}>
      <span className="recap-tile-art" aria-hidden="true"><AlbumArt title={period.title} {...(cover ? { image: cover } : {})} size="medium" /></span>
      <span className="recap-tile-top">
        <span className="recap-tile-icon" aria-hidden="true"><Icon size={18} /></span>
        {isNew && <NewBadge />}
      </span>
      <span className="recap-tile-copy">
        <small>{period.eyebrow}</small>
        <strong>{period.title}</strong>
        <span>{subtitle}</span>
      </span>
      <span className="recap-tile-foot">
        <span>{shortTime(period.listeningMs)} · {period.playCount === 1 ? t("recap.page.playsOne") : t("recap.page.plays", { plays: recapCount(period.playCount) })}</span>
        <span className="recap-tile-play" aria-hidden="true"><Play size={13} fill="currentColor" /></span>
      </span>
    </button>
  );
}

/**
 * One month of the calendar: its recap with covers, the running month so
 * far, or a quiet placeholder for months without enough music or still to come.
 */
export function RecapMonthTile({ month, period, preview, isNew, state, soFarMs, onOpen }: {
  month: number;
  period: RecapPeriod | undefined;
  preview: RecapPreview | undefined;
  isNew: boolean;
  state: "recap" | "running" | "quiet" | "future";
  soFarMs: number;
  onOpen: (period: RecapPeriod) => void;
}) {
  const name = monthName(month);
  if (!period || state !== "recap") {
    return <div className="recap-month" data-state={state} aria-label={name}>
      <strong>{name}</strong>
      <small>{state === "running" ? t("recap.page.running", { time: shortTime(soFarMs) })
        : state === "quiet" ? soFarMs > 0 ? t("recap.page.quiet") : t("recap.page.noMusic") : ""}</small>
    </div>;
  }
  const covers = preview?.coverUris ?? [];
  return (
    <button type="button" className="recap-month recap-tile" data-state="recap" onClick={() => onOpen(period)} aria-label={period.title}>
      <span className="recap-tile-art" aria-hidden="true"><AlbumArt title={period.title} {...(covers[0] ? { image: covers[0] } : {})} size="medium" /></span>
      <span className="recap-tile-top">
        <span className="recap-month-mosaic"><RecapCoverMosaic covers={covers} title={period.title} /></span>
        {isNew && <NewBadge />}
      </span>
      <span className="recap-tile-copy">
        <strong>{name}</strong>
        {preview?.topArtistName && <span>{t("recap.page.mostly", { name: preview.topArtistName })}</span>}
      </span>
      <span className="recap-tile-foot">
        <span>{shortTime(period.listeningMs)}</span>
        <span className="recap-tile-play" aria-hidden="true"><Play size={13} fill="currentColor" /></span>
      </span>
    </button>
  );
}
