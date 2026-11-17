import { AlbumArt } from "../../components/AlbumArt";

/** Fanned covers for the featured recap; the most played one in front. */
export function RecapCoverStack({ covers, title }: { covers: string[]; title: string }) {
  const shown = covers.slice(0, 4);
  return (
    <div className="recap-cover-stack" data-count={shown.length} aria-hidden="true">
      {shown.length === 0 && <span className="recap-cover-slot is-placeholder"><AlbumArt title={title} size="medium" /></span>}
      {shown.map((cover, index) => (
        <span key={cover} className="recap-cover-slot" data-position={index}>
          <AlbumArt title={title} image={cover} size="medium" priority={index === 0} />
        </span>
      ))}
    </div>
  );
}

/** Four covers in a square, filled up with placeholders. */
export function RecapCoverMosaic({ covers, title }: { covers: string[]; title: string }) {
  const tiles = covers.length >= 4 ? covers.slice(0, 4) : covers.slice(0, 1);
  return (
    <div className="recap-cover-mosaic" data-count={tiles.length} aria-hidden="true">
      {tiles.length === 0 ? <AlbumArt title={title} size="medium" /> : tiles.map((cover) => (
        <AlbumArt key={cover} title={title} image={cover} size="medium" />
      ))}
    </div>
  );
}

/** Small overlapping covers for a week row. */
export function RecapCoverRow({ covers, title }: { covers: string[]; title: string }) {
  const shown = covers.slice(0, 3);
  return (
    <div className="recap-cover-row" aria-hidden="true">
      {shown.length === 0 ? <AlbumArt title={title} size="small" /> : shown.map((cover) => (
        <AlbumArt key={cover} title={title} image={cover} size="small" />
      ))}
    </div>
  );
}
