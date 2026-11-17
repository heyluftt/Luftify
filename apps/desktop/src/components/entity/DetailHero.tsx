import { Play } from "lucide-react";
import type { ReactNode } from "react";
import { AlbumArt } from "../AlbumArt";
import { t } from "../../i18n";
import { useCoverTint } from "../../features/theme/useCoverTint";
import { EntityHeroWash } from "./EntityHeroWash";

interface DetailHeroProps {
  kind: string;
  name: string;
  subtitle: string | undefined;
  image: string | undefined;
  onImageContextMenu?: (() => void) | undefined;
  /** Artists: round portrait instead of a square cover. */
  round?: boolean;
  onPlay?: (() => void) | undefined;
  /** Next to the play button. */
  actions?: ReactNode | undefined;
  /** Right end of the action row (search, sort, counts). */
  toolbar?: ReactNode;
}

/**
 * Header of playlist, album and artist pages: the cover, a big title, one
 * meta line; below it the action row. The cover lends the page a faint
 * wash of its colour at the top, nothing more.
 */
export function DetailHero({
  kind,
  name,
  subtitle,
  image,
  onImageContextMenu,
  round = false,
  onPlay,
  actions,
  toolbar,
}: DetailHeroProps) {
  const tint = useCoverTint(image);
  return (
    <>
      <section className={round ? "entity-hero is-round" : "entity-hero"} style={tint}>
        <EntityHeroWash tint={tint} />
        <div className="entity-hero-art" onContextMenu={onImageContextMenu ? (event) => { event.preventDefault(); onImageContextMenu(); } : undefined}>
          <AlbumArt title={name} size="feature" image={image} priority />
        </div>
        <div className="entity-hero-copy">
          <span className="entity-hero-kind">{kind}</span>
          <h1 title={name}>{name}</h1>
          {subtitle && <p className="entity-hero-meta">{subtitle}</p>}
        </div>
      </section>

      {(onPlay || actions || toolbar) && (
        <div className="entity-actions">
          {onPlay && (
            <button type="button" className="play-fab" aria-label={t("entity.playName", { name })} title={t("home.play")} onClick={onPlay}>
              <Play fill="currentColor" size={22} />
            </button>
          )}
          {actions}
          {toolbar && <div className="entity-actions-end">{toolbar}</div>}
        </div>
      )}
    </>
  );
}
