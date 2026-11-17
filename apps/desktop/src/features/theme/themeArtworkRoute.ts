export type ThemeArtworkRoute =
  | "home"
  | "discovery"
  | "radio"
  | "lyrics"
  | "solo"
  | "none";

export function themeArtworkRoute(pathname: string): ThemeArtworkRoute {
  const route = pathname.replace(/\/+$/, "") || "/";

  if (route === "/") return "home";

  if (
    route === "/search"
    || route === "/library"
    || route === "/liked"
  ) {
    return "discovery";
  }

  if (route === "/queue" || route === "/insights" || route === "/recaps") {
    return "radio";
  }

  if (route === "/lyrics" || route === "/modules/lyrics") {
    return "lyrics";
  }

  if (
    route.startsWith("/artist/")
    || route.startsWith("/album/")
    || route.startsWith("/playlist/")
  ) {
    return "none";
  }

  return "solo";
}
