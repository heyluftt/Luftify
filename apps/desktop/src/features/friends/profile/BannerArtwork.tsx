import { useId } from "react";
import { CandyArt, MonoArt, NebulaArt, OceanArt } from "./banners/AbstractBanners";
import { CityArt } from "./banners/CityBanner";
import { AuroraArt, MidnightArt, SunsetArt } from "./banners/LandscapeBanners";

const SCENES: Record<string, (props: { id: string }) => React.ReactNode> = {
  aurora: AuroraArt, sunset: SunsetArt, midnight: MidnightArt, city: CityArt,
  ocean: OceanArt, nebula: NebulaArt, candy: CandyArt, mono: MonoArt,
};

/**
 * The drawn scene of a preset background (styles in profile-banners.css).
 * Landscapes keep their proportions and stand on the lower edge; wide
 * banners show more sky, narrow ones crop the sides.
 */
export function BannerArtwork({ banner }: { banner: string }) {
  const id = useId().replace(/:/g, "");
  const Scene = SCENES[banner];
  if (!Scene) return null;
  return <svg className="profile-banner-artwork" viewBox="0 0 900 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <defs>
      <filter id={`${id}-blur`} x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4" /></filter>
      <filter id={`${id}-blur-wide`} x="-50%" y="-100%" width="200%" height="300%"><feGaussianBlur stdDeviation="28" /></filter>
    </defs>
    <Scene id={id} />
  </svg>;
}
