import type {
  EntitySummary,
  MediaCreator,
} from "@luft/protocol-types";
import {
  Link,
  useInRouterContext,
} from "react-router-dom";
import type { MouseEvent } from "react";
import { t } from "../../i18n";

interface ArtistLinksProps {
  creators: readonly MediaCreator[] | undefined;
  className?: string;
  fallback?: string;
}

interface ArtistDestination {
  path: string;
  summary?: EntitySummary;
}

export function ArtistLinks({
  creators,
  className,
  fallback = t("shell.unknownArtist"),
}: ArtistLinksProps) {
  const inRouter = useInRouterContext();
  const visibleCreators = (creators ?? []).filter(
    (creator) => creator.name.trim().length > 0,
  );

  if (visibleCreators.length === 0) {
    return (
      <span className={joinClassNames("artist-links", className)}>
        {fallback}
      </span>
    );
  }

  const title = visibleCreators
    .map((creator) => creator.name.trim())
    .join(", ");

  return (
    <span
      className={joinClassNames("artist-links", className)}
      title={title}
    >
      {visibleCreators.map((creator, index) => {
        const name = creator.name.trim();
        const destination = artistDestination({
          ...creator,
          name,
        });
        const separator =
          index < visibleCreators.length - 1 ? ", " : "";

        return (
          <ArtistLink
            destination={destination}
            inRouter={inRouter}
            key={`${creator.uri ?? name}:${index}`}
            name={name}
            separator={separator}
          />
        );
      })}
    </span>
  );
}

interface ArtistLinkProps {
  destination: ArtistDestination;
  inRouter: boolean;
  name: string;
  separator: string;
}

function ArtistLink({
  destination,
  inRouter,
  name,
  separator,
}: ArtistLinkProps) {
  const stopTrackClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
  };

  if (!inRouter) {
    return (
      <>
        <a
          className="artist-link"
          href={`#${destination.path}`}
          onClick={stopTrackClick}
        >
          {name}
        </a>
        {separator}
      </>
    );
  }

  return (
    <>
      <Link
        className="artist-link"
        to={destination.path}
        state={destination.summary}
        onClick={stopTrackClick}
      >
        {name}
      </Link>
      {separator}
    </>
  );
}

export function artistDestination(
  creator: MediaCreator,
): ArtistDestination {
  const name = creator.name.trim();
  const uri = creator.uri?.trim();

  if (uri && isArtistUri(uri)) {
    return {
      path: `/artist/${encodeURIComponent(uri)}`,
      summary: {
        uri,
        name,
        subtitle: t("shell.artist"),
      },
    };
  }

  const params = new URLSearchParams({
    q: name,
    type: "artists",
  });

  return { path: `/search?${params.toString()}` };
}

function isArtistUri(uri: string): boolean {
  return (
    uri.startsWith("spotify:artist:") ||
    uri.startsWith("mock:artist:")
  );
}

function joinClassNames(
  base: string,
  className: string | undefined,
) {
  return [base, className].filter(Boolean).join(" ");
}
