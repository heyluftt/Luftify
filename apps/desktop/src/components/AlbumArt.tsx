import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import { t } from "../i18n";
import { cachedCover, coverProtocolAvailable, coverProtocolUrl, coverQueryOptions, subscribeCoverProtocol } from "./coverQuery";
import type { CoverSize } from "./coverSizing";
import { observeCoverVisibility } from "./coverVisibility";

export function AlbumArt({
  title,
  size = "medium",
  image,
  priority = false,
}: {
  title: string;
  size?: CoverSize;
  image?: string | undefined;
  priority?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(
    () => priority || typeof IntersectionObserver === "undefined",
  );
  const original = image?.startsWith("https://") ? image : undefined;
  // In the app: an image URL on the cover scheme, sized to what is shown.
  const protocol = useSyncExternalStore(subscribeCoverProtocol, coverProtocolAvailable);
  const protocolUrl = original && protocol ? coverProtocolUrl(original, size) : undefined;
  // Elsewhere: the data-URI cache; an already loaded bigger cover is reused.
  const cached = original && !protocolUrl ? cachedCover(queryClient, original, size) : undefined;
  useEffect(() => {
    if (visible || priority || !original || cached || !element.current) return;
    return observeCoverVisibility(element.current, () => setVisible(true));
  }, [visible, priority, original, cached]);
  const cover = useQuery({
    // Without a URL (or on the cover scheme) the query stays disabled.
    ...coverQueryOptions(original ?? "", size),
    enabled: Boolean(original) && !protocolUrl && (visible || priority),
    ...(cached ? { initialData: cached } : {}),
  });
  const hue = [...title].reduce((value, character) => value + character.charCodeAt(0), 0) % 360;
  const dataImage = image?.startsWith("data:image/") ? image : cover.data ?? cached;
  const style: CSSProperties = protocolUrl && (visible || priority)
    // The placeholder stays underneath until the image has loaded.
    ? { "--cover-hue": hue, backgroundImage: `url("${protocolUrl}"), var(--album-art-placeholder)` } as CSSProperties
    : dataImage
      ? { backgroundImage: `url(${dataImage})` }
      : { "--cover-hue": hue } as CSSProperties;
  return <div ref={element} className={`album-art ${size}`} style={style} role="img" aria-label={t("shell.coverOf", { title })} />;
}
