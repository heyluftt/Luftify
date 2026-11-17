import { useLayoutEffect, type RefObject } from "react";
import { flyCoverTo } from "./coverFlight";

/** Lets a cover launched from a card land on `coverRef` when `songKey` changes. */
export function useCoverLanding(coverRef: RefObject<HTMLElement | null>, songKey: string) {
  useLayoutEffect(() => {
    const art = coverRef.current?.querySelector<HTMLElement>(".album-art");
    if (art && songKey !== "empty") flyCoverTo(art);
  }, [coverRef, songKey]);
}
