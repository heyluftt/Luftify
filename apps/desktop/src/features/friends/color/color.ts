/** Colour maths for the profile colour picker. Hex is `#rrggbb` in lowercase. */
export interface Hsv { h: number; s: number; v: number }

/** The preset accents as drawn in profile-appearance.css. */
export const ACCENT_HEX: Record<string, string> = {
  sky: "#7cc8ff", violet: "#b39bff", rose: "#ff7aa8", amber: "#ffc15c",
  mint: "#4fe0b0", coral: "#ff8a65", gold: "#ffd166", slate: "#9aa7bd",
};

export const isHex = (value: string) => /^#[0-9a-f]{6}$/.test(value);

/** Accepts `#abc`, `abc`, `#aabbcc` and upper case; null for anything else. */
export function normalizeHex(value: string): string | null {
  let hex = value.trim().toLowerCase().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(hex)) hex = [...hex].map((char) => char + char).join("");
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

const rgb = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255) as [number, number, number];

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let h = 0;
  if (delta) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? delta / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[f(5), f(3), f(1)].map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** One source for the automatic stop in the picker and every profile name. */
export function matchingNameColor(hex: string): string {
  const { h, s, v } = hexToHsv(hex);
  return hsvToHex({ h: (h + 50) % 360, s: s * .85, v: Math.min(1, v + .1) });
}

/** Choose the higher contrast ink for arbitrary profile-button colours. */
export function profileInk(hex: string): string {
  const luminance = (color: string) => rgb(color).map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index]!, 0);
  const value = luminance(hex);
  const dark = (value + .05) / (luminance("#081321") + .05);
  const light = (luminance("#ecf4ff") + .05) / (value + .05);
  return dark >= light ? "var(--profile-night)" : "var(--profile-paper)";
}

/** The preset closest to a colour, which older apps show instead of it. */
export function nearestAccent(hex: string): string {
  const [r, g, b] = rgb(hex);
  let best = "sky";
  let distance = Infinity;
  for (const [key, preset] of Object.entries(ACCENT_HEX)) {
    const [pr, pg, pb] = rgb(preset);
    const next = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (next < distance) { distance = next; best = key; }
  }
  return best;
}
