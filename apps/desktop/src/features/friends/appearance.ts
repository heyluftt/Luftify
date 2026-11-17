import type { CSSProperties } from "react";
import type { MessageKey } from "../../i18n";
import { ACCENT_HEX, isHex, matchingNameColor, profileInk } from "./color/color";
import type { ProfileStyle, SocialProfile } from "./friendsTypes";

/** Mirrors PROFILE_ACCENTS and PROFILE_BANNERS in luft-listen-together. */
export const PROFILE_ACCENTS = ["sky", "violet", "rose", "amber", "mint", "coral", "gold", "slate"] as const;
export const PROFILE_BANNERS = ["aurora", "sunset", "ocean", "nebula", "midnight", "city", "candy", "mono", "cover"] as const;
export type ProfileBanner = (typeof PROFILE_BANNERS)[number];
/** Mirrors PROFILE_FRAMES, PROFILE_EFFECTS and PROFILE_EMOJIS; "" is the default. */
export const PROFILE_FRAMES = ["", "accent", "glow", "prism", "orbit", "pulse", "aurum", "none"] as const;
export const PROFILE_EFFECTS = ["", "stars", "sparkle", "waves", "veil", "lights", "petals"] as const;
export const PROFILE_EMOJIS = ["🎧", "🎶", "🔥", "✨", "💜", "💙", "🖤", "🌙", "☀️", "🌊", "🌸", "🍀",
  "☕", "🎮", "📚", "💤", "🚗", "🏋️", "🎉", "😎", "🥲", "🤍", "⚡", "🌈"] as const;
export const frameLabel = (frame: string) => `appearance.frame.${frame || "role"}` as MessageKey;
export const effectLabel = (effect: string) => `appearance.effect.${effect || "none"}` as MessageKey;

/** "" is the standard background (role colours or the cover being heard). */
export const DEFAULT_STYLE: ProfileStyle = { accent: "sky", banner: "" };

export const bannerLabel = (banner: string) => `appearance.banner.${banner}` as MessageKey;
export const accentLabel = (accent: string) => `badges.colorName.${accent}` as MessageKey;

/** The look a profile chose; profiles without one keep the plain look. */
export function profileLook(profile: Pick<SocialProfile, "style" | "favorite">) {
  const style = profile.style ?? null;
  const bannerMedia = style?.bannerMedia || undefined;
  // A cover banner without a profile song has nothing to show.
  const preset = style?.banner === "cover" && !profile.favorite?.coverUri ? undefined : style?.banner || undefined;
  // An effect also needs a canvas when the standard background is selected.
  const banner = bannerMedia ? "media" : preset || (style?.effect ? "mono" : undefined);
  const color = style?.color && isHex(style.color) ? style.color : undefined;
  const nameColor = style?.nameColor && isHex(style.nameColor) ? style.nameColor : undefined;
  const nameFrom = style?.nameFrom && isHex(style.nameFrom) ? style.nameFrom : undefined;
  return {
    accent: style?.accent,
    color,
    banner,
    bannerMedia,
    avatarMedia: style?.avatarMedia || undefined,
    cover: banner === "cover" ? profile.favorite?.coverUri : undefined,
    frame: style?.frame || undefined,
    effect: style?.effect || undefined,
    nameGradient: Boolean(style?.nameGradient),
    nameColor,
    nameFrom,
    emoji: style?.emoji ?? undefined,
  };
}

/** An own colour overrides the preset's `--profile-accent` on that element. */
export const accentColor = (color: string | null | undefined): CSSProperties | undefined =>
  color && isHex(color) ? { "--profile-accent": color, "--profile-on-accent": profileInk(color) } as CSSProperties : undefined;

/** Attributes for the profile name: the gradient switch and where it starts and runs to. */
export function nameAttrs(look: Pick<ReturnType<typeof profileLook>, "nameGradient" | "nameColor" | "nameFrom"> & { color?: string | undefined; accent?: string | undefined }) {
  const from = look.nameFrom ?? look.color ?? ACCENT_HEX[look.accent ?? "sky"] ?? ACCENT_HEX.sky!;
  const colors = {
    "--name-to": look.nameColor ?? matchingNameColor(from),
    ...(look.nameFrom ? { "--name-start": look.nameFrom } : {}),
  };
  return {
    "data-gradient": look.nameGradient || undefined,
    style: look.nameGradient ? colors as CSSProperties : undefined,
  };
}
