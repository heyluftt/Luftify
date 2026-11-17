import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex, nearestAccent, normalizeHex, matchingNameColor, profileInk } from "../src/features/friends/color/color";
import { nameAttrs, profileLook } from "../src/features/friends/appearance";

describe("profile colour", () => {
  it("round-trips colours and finds the preset older apps show", () => {
    for (const hex of ["#1b7abf", "#ff7aa8", "#000000", "#ffffff", "#4fe0b0"]) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    expect(normalizeHex(" #ABC ")).toBe("#aabbcc");
    expect(normalizeHex("red")).toBeNull();
    expect(nearestAccent("#ff70a0")).toBe("rose");
    expect(nearestAccent("#50e0b0")).toBe("mint");
  });

  it("prefers an own banner and ignores colours that are no hex", () => {
    const look = profileLook({ style: { accent: "rose", banner: "ocean", color: "url(x)", bannerMedia: "0123456789abcdef0123456789abcdef.webm" }, favorite: null });
    expect(look.banner).toBe("media");
    expect(look.color).toBeUndefined();
    expect(profileLook({ style: { accent: "rose", banner: "ocean", color: "#112233" }, favorite: null })).toMatchObject({ banner: "ocean", color: "#112233" });
  });

  it("keeps the automatic name stop consistent with the picker and respects own stops", () => {
    const look = profileLook({ style: { accent: "mint", banner: "", color: "#2468ac", nameGradient: true }, favorite: null });
    expect(nameAttrs(look).style).toMatchObject({ "--name-to": matchingNameColor("#2468ac") });
    const own = { ...look, nameFrom: "#ff7aa8", nameColor: "#ffd166" };
    expect(nameAttrs(own).style).toMatchObject({ "--name-start": "#ff7aa8", "--name-to": "#ffd166" });
    expect(nameAttrs({ ...own, nameGradient: false }).style).toBeUndefined();
    expect(profileInk("#112233")).toBe("var(--profile-paper)");
    expect(profileInk("#ffffff")).toBe("var(--profile-night)");
  });

  it("gives effects a canvas without overriding a chosen banner", () => {
    expect(profileLook({ style: { accent: "sky", banner: "", effect: "waves" }, favorite: null }).banner).toBe("mono");
    expect(profileLook({ style: { accent: "sky", banner: "sunset", effect: "waves" }, favorite: null }).banner).toBe("sunset");
    expect(profileLook({ style: null, favorite: null }).banner).toBeUndefined();
  });
});
