import { useEffect, useRef } from "react";
import { t } from "../../i18n";
import { mixAge, mixSummary } from "./mixPresentation";
import type { SavedMix } from "./mixLibrary";

export function MixCardHeader({ mix, title, latest, selected, editing, onSelect, onFinish }: {
  mix: SavedMix; title: string; latest: boolean; selected: boolean; editing: boolean;
  onSelect: () => void; onFinish: (name?: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const open = useRef<HTMLButtonElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    if (!editing) return;
    finished.current = false;
    input.current?.focus();
    input.current?.select();
  }, [editing]);
  const finish = (save: boolean, restoreFocus = false) => {
    if (finished.current) return;
    finished.current = true;
    const value = input.current?.value.trim();
    onFinish(save && value && value !== title ? value : undefined);
    if (restoreFocus) open.current?.focus();
  };
  return <>
    {/* Covers the whole card; play and tool buttons sit above it. */}
    <button ref={open} className="mix-card-open-target" type="button"
      aria-label={t(selected ? "discovery.hideTracksOf" : "discovery.showTracksOf", { title })}
      aria-expanded={selected} onClick={onSelect} />
    <span className="mix-card-copy">
      <small className="mix-card-meta">
        {latest && <span className="mix-card-badge">{t("discovery.latestBadge")}</span>}
        {mixAge(mix)}
      </small>
      {editing ? <input ref={input} className="mix-card-name" aria-label={t("discovery.rename")}
        maxLength={80} defaultValue={title} onBlur={() => finish(true)}
        onContextMenu={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault(); event.stopPropagation();
            finish(event.key === "Enter", true);
          }
        }} /> : <strong title={title}>{title}</strong>}
      <span>{mixSummary(mix)}</span>
    </span>
  </>;
}
