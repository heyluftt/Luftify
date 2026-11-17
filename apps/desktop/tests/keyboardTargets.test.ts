import { describe, expect, it } from "vitest";
import { isInteractiveKeyboardTarget } from "../src/layouts/keyboardTargets";

describe("global keyboard target filtering", () => {
  it("keeps Space available to native controls and their descendants", () => {
    const button = document.createElement("button");
    const icon = document.createElement("span");
    button.append(icon);
    expect(isInteractiveKeyboardTarget(button)).toBe(true);
    expect(isInteractiveKeyboardTarget(icon)).toBe(true);
    expect(isInteractiveKeyboardTarget(document.createElement("select"))).toBe(true);
  });

  it("allows the global playback shortcut on passive layout elements", () => {
    expect(isInteractiveKeyboardTarget(document.createElement("div"))).toBe(false);
    expect(isInteractiveKeyboardTarget(null)).toBe(false);
  });
});
