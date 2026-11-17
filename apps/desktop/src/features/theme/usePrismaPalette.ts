import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { desktopApi } from "../../services/desktopApi";
import { usePlayerStore } from "../../stores/playerStore";
import {
  DEFAULT_COVER_PALETTE,
  extractCoverPalette,
  paletteSignature,
  prismaSurfacesFromPalette,
  type CoverPalette,
} from "./coverPalette";
import { intensifyPrismaPalette, normalizePrismaPalette, prismaPigments } from "./prismaMaterial";

const PRISMA_THEME_ID = "luft.prisma";
const PALETTE_TRANSITION_MS = 1_500;

interface PaletteTransition {
  current: CoverPalette;
  previous?: CoverPalette;
  revision: number;
}

export function usePrismaPalette(crossfade = false) {
  const [active, setActive] = useState(
    () => document.documentElement.dataset.theme === PRISMA_THEME_ID,
  );
  const coverUri = usePlayerStore((store) => store.playback?.currentItem?.coverUri);
  const remoteCover = coverUri?.startsWith("https://") ? coverUri : undefined;
  const directCover = coverUri?.startsWith("data:image/") ? coverUri : undefined;
  const cover = useQuery({
    queryKey: ["cover", remoteCover],
    queryFn: () => desktopApi.coverData(remoteCover!),
    enabled: active && Boolean(remoteCover),
    staleTime: Infinity,
    retry: false,
  });
  const imageSource = directCover ?? (remoteCover ? cover.data : undefined);
  const [transition, setTransition] = useState<PaletteTransition>({
    current: DEFAULT_COVER_PALETTE,
    revision: 0,
  });

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setActive(root.dataset.theme === PRISMA_THEME_ID);
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    sync();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!active) return;
    if (!imageSource) {
      if ((!directCover && !remoteCover) || cover.isError) {
        setNextPalette(setTransition, intensifyPrismaPalette(DEFAULT_COVER_PALETTE), crossfade);
      }
      return;
    }
    let cancelled = false;
    void extractCoverPalette(imageSource, coverUri ?? imageSource).then((palette) => {
      if (!cancelled && document.documentElement.dataset.theme === PRISMA_THEME_ID) {
        setNextPalette(setTransition, normalizePrismaPalette(intensifyPrismaPalette(palette)), crossfade);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [active, cover.isError, coverUri, directCover, remoteCover, imageSource, crossfade]);

  useEffect(() => {
    if (!transition.previous) return;
    const revision = transition.revision;
    const timeout = window.setTimeout(() => {
      setTransition((current) => current.revision === revision
        ? { current: current.current, revision: current.revision }
        : current);
    }, PALETTE_TRANSITION_MS);
    return () => window.clearTimeout(timeout);
  }, [transition.previous, transition.revision]);

  useEffect(() => {
    const root = document.documentElement;
    if (!active || root.dataset.theme !== PRISMA_THEME_ID) {
      removePrismaProperties(root);
      return;
    }
    const palette = transition.current;
    const surfaces = prismaSurfacesFromPalette(palette);
    root.style.setProperty("--prisma-primary", palette.primary);
    root.style.setProperty("--prisma-secondary", palette.secondary);
    root.style.setProperty("--prisma-highlight", palette.highlight);
    root.style.setProperty("--prisma-shadow", palette.shadow);
    root.style.setProperty("--prisma-ui-primary", palette.uiPrimary);
    root.style.setProperty("--prisma-ui-secondary", palette.uiSecondary);
    root.style.setProperty("--prisma-on-accent", surfaces.onAccent);
    root.style.setProperty("--prisma-vividness", String(palette.vividness));
    root.style.setProperty("--prisma-energy", String(palette.energy));
    root.style.setProperty("--prisma-contrast", String(palette.contrast));
    root.style.setProperty("--prisma-focus-x", `${palette.focusX}%`);
    root.style.setProperty("--prisma-focus-y", `${palette.focusY}%`);
    root.style.setProperty("--prisma-angle", `${palette.angle}deg`);
    root.style.setProperty("--prisma-ink", surfaces.ink);
    root.style.setProperty("--prisma-panel", surfaces.panel);
    root.style.setProperty("--prisma-raised", surfaces.raised);
    root.style.setProperty("--color-accent", palette.uiSecondary);
    prismaPigments(palette).forEach((pigment, index) => {
      root.style.setProperty(`--prisma-pigment-${index + 1}`, pigment);
    });
  }, [active, transition.current]);

  useEffect(() => () => {
    removePrismaProperties(document.documentElement);
  }, []);

  return { active, transition };
}

function setNextPalette(
  setter: Dispatch<SetStateAction<PaletteTransition>>,
  next: CoverPalette,
  crossfade: boolean,
) {
  setter((current) => {
    if (paletteSignature(current.current) === paletteSignature(next)) return current;
    return {
      current: next,
      ...(crossfade ? { previous: current.current } : {}),
      revision: current.revision + 1,
    };
  });
}

function removePrismaProperties(root: HTMLElement) {
  root.style.removeProperty("--prisma-primary");
  root.style.removeProperty("--prisma-secondary");
  root.style.removeProperty("--prisma-highlight");
  root.style.removeProperty("--prisma-shadow");
  root.style.removeProperty("--prisma-ui-primary");
  root.style.removeProperty("--prisma-ui-secondary");
  root.style.removeProperty("--prisma-on-accent");
  root.style.removeProperty("--prisma-vividness");
  root.style.removeProperty("--prisma-energy");
  root.style.removeProperty("--prisma-contrast");
  root.style.removeProperty("--prisma-focus-x");
  root.style.removeProperty("--prisma-focus-y");
  root.style.removeProperty("--prisma-angle");
  root.style.removeProperty("--prisma-ink");
  root.style.removeProperty("--prisma-panel");
  root.style.removeProperty("--prisma-raised");
  root.style.removeProperty("--color-accent");
  for (let index = 1; index <= 4; index += 1) root.style.removeProperty(`--prisma-pigment-${index}`);
}
