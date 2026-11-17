import { AlbumArt } from "../../components/AlbumArt";

// Record sleeve: the disc peeks out, slides further out while the playlist is
// the playback context and spins while audio runs. Purely decorative.
export function HomeFeatureSleeve({ title, image, live, playing }: {
  title: string;
  image: string | undefined;
  live: boolean;
  playing: boolean;
}) {
  const className = [
    "home-feature-art",
    "home-sleeve",
    live ? "is-live" : "",
    playing ? "is-turning" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className={className}>
      <span className="home-vinyl" aria-hidden="true">
        <span className="home-vinyl-disc">
          <span className="home-vinyl-label" />
        </span>
      </span>
      <AlbumArt title={title} size="feature" image={image} priority />
    </div>
  );
}

/** Three bars that dance while playing and rest when paused. */
export function HomeLiveBars({ playing }: { playing: boolean }) {
  return (
    <span className={`home-live-bars${playing ? " is-playing" : ""}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
