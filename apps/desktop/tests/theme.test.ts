import { describe, expect, it } from "vitest";
import { applyTheme, applyThemeMode, abyssTheme, aerisTheme, atelierTheme, calamusTheme, darkTheme, lightTheme, luftTheme, modularTheme, pixelpopTheme, polarisTheme, prismaTheme, redlineTheme, roseTheme, themeSchema } from "../src/themes/theme";

describe("theme validation", () => {
  it("loads Aeris by its persisted id and retains readable daylight contrast", async () => {
    await applyThemeMode("luft.aeris");
    expect(document.documentElement.dataset.theme).toBe(aerisTheme.id);
    const { colors } = aerisTheme;
    expect(contrast(colors.primary, colors.surfaceElevated)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.textPrimary, colors.surface)).toBeGreaterThanOrEqual(6);
    expect(contrast(colors.textMuted, colors.surface)).toBeGreaterThanOrEqual(4.5);
  });
  it("loads Pixelpop by its persisted id with readable pixel text", async () => {
    await applyThemeMode("luft.pixelpop");
    expect(document.documentElement.dataset.theme).toBe(pixelpopTheme.id);
    const { colors } = pixelpopTheme;
    expect(contrast(colors.textPrimary, colors.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(colors.textMuted, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.primary, colors.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("loads Modular by its persisted id with readable panel text", async () => {
    await applyThemeMode("luft.modular");
    expect(document.documentElement.dataset.theme).toBe(modularTheme.id);
    const { colors } = modularTheme;
    expect(contrast(colors.textPrimary, colors.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(colors.textMuted, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.primary, colors.background)).toBeGreaterThanOrEqual(4.5);
  });

  it("rejects script-like color values", () => {
    expect(() => themeSchema.parse({ ...darkTheme, colors: { ...darkTheme.colors, primary: "url(javascript:alert(1))" } })).toThrow();
  });

  it("applies validated CSS properties", () => {
    applyTheme(darkTheme);
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe(darkTheme.colors.primary);
  });

  it("applies the light palette for an explicit light selection", async () => {
    await applyThemeMode("light");
    expect(document.documentElement.dataset.theme).toBe(lightTheme.id);
    expect(document.documentElement.style.getPropertyValue("--color-text")).toBe(lightTheme.colors.textPrimary);
  });

  it("applies Atelier as an independent light theme", async () => {
    await applyThemeMode("atelier");
    expect(document.documentElement.dataset.theme).toBe(atelierTheme.id);
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("#145F57");
    expect(document.documentElement.style.getPropertyValue("--color-bg")).toBe("#EFE9DD");
    expect(document.documentElement.style.getPropertyValue("--color-text")).toBe("#29251E");
    expect(document.documentElement.style.getPropertyValue("--color-muted")).toBe("#6B6458");
  });

  it("applies Luft Violet as an independent dark theme", async () => {
    await applyThemeMode("luft");
    expect(document.documentElement.dataset.theme).toBe(luftTheme.id);
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe(luftTheme.colors.primary);
    expect(document.documentElement.style.getPropertyValue("--color-bg")).toBe(luftTheme.colors.background);
    expect(document.documentElement.style.getPropertyValue("--color-text")).toBe(luftTheme.colors.textPrimary);
    expect(document.documentElement.style.getPropertyValue("--color-muted")).toBe(luftTheme.colors.textMuted);
  });

  it("applies Redline without falling back to the system theme", async () => {
    await applyThemeMode("redline");
    expect(document.documentElement.dataset.theme).toBe(redlineTheme.id);
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe(redlineTheme.colors.primary);
    expect(document.documentElement.style.getPropertyValue("--color-text")).toBe(redlineTheme.colors.textPrimary);
  });

  it("applies Tiefsee and moves the removed Bernstein to Luft Dark", async () => {
    await applyThemeMode("abyss");
    expect(document.documentElement.dataset.theme).toBe(abyssTheme.id);
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe(abyssTheme.colors.primary);
    await applyThemeMode("bernstein");
    expect(document.documentElement.dataset.theme).toBe(darkTheme.id);
  });

  it("applies Rosé Nocturne as a velvet night theme", async () => {
    await applyThemeMode("rose");
    expect(document.documentElement.dataset.theme).toBe(roseTheme.id);
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("#E3A3B8");
    expect(document.documentElement.style.getPropertyValue("--color-bg")).toBe("#0E070C");
    expect(document.documentElement.style.getPropertyValue("--color-text")).toBe("#F7EEF2");
  });

  it("applies Polaris as a starfield night theme", async () => {
    await applyThemeMode("polaris");
    expect(document.documentElement.dataset.theme).toBe(polarisTheme.id);
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("#9CCBFF");
    expect(document.documentElement.style.getPropertyValue("--color-bg")).toBe("#04070F");
    expect(document.documentElement.style.getPropertyValue("--color-text")).toBe("#EEF3FB");
  });

  it("applies Prisma as the cover-reactive matte theme", async () => {
    await applyThemeMode("prisma");
    expect(document.documentElement.dataset.theme).toBe(prismaTheme.id);
    // Prisma follows the live cover palette and falls back to its fixed colors.
    expect(document.documentElement.style.getPropertyValue("--color-primary"))
      .toBe(`var(--prisma-ui-primary, ${prismaTheme.colors.primary})`);
    expect(document.documentElement.style.getPropertyValue("--color-bg")).toBe(`var(--prisma-ink, ${prismaTheme.colors.background})`);
  });

  it("applies Calamus as a sharp notebook theme", async () => {
    await applyThemeMode("calamus");
    expect(document.documentElement.dataset.theme).toBe(calamusTheme.id);
    expect(document.documentElement.style.getPropertyValue("--color-primary")).toBe("#6A8FEA");
    expect(document.documentElement.style.getPropertyValue("--color-bg")).toBe("#0F0E0D");
    expect(document.documentElement.style.getPropertyValue("--color-text")).toBe("#EEE9DF");
    expect(document.documentElement.style.getPropertyValue("--radius")).toBe("3px");
    expect(document.documentElement.style.getPropertyValue("--blur")).toBe("0px");
  });

  it("maps the previous Kladde id onto Calamus", async () => {
    await applyThemeMode("kladde");
    expect(document.documentElement.dataset.theme).toBe(calamusTheme.id);
    await applyThemeMode("luft.kladde");
    expect(document.documentElement.dataset.theme).toBe(calamusTheme.id);
  });

  it("falls back to dark for removed theme ids", async () => {
    await applyThemeMode("whiteout");
    expect(document.documentElement.dataset.theme).toBe(darkTheme.id);
    await applyThemeMode("neon-sakura");
    expect(document.documentElement.dataset.theme).toBe(darkTheme.id);
  });

  it("maps the removed system theme to dark", async () => {
    await applyThemeMode("system");
    expect(document.documentElement.dataset.theme).toBe(darkTheme.id);
  });

  it("switches only once the theme's styles are loaded, and the latest request wins", async () => {
    const first = applyThemeMode("polaris");
    const second = applyThemeMode("rose");
    await Promise.all([first, second]);
    expect(document.documentElement.dataset.theme).toBe(roseTheme.id);
  });
});

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const [r, g, blue] = hex.slice(1).match(/../g)!.map(value => {
      const channel = parseInt(value, 16) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    });
    return r! * .2126 + g! * .7152 + blue! * .0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
