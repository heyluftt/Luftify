import { afterEach, describe, expect, it } from "vitest";
import { suppressWebPageControls } from "../src/layouts/webPageControls";

describe("web page controls", () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("cancels the default browser context menu", () => {
    restore = suppressWebPageControls();
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    expect(document.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  it("still delivers the event so app menus can open", () => {
    restore = suppressWebPageControls();
    let reached = false;
    const host = document.createElement("div");
    host.addEventListener("contextmenu", () => {
      reached = true;
    });
    document.body.append(host);
    host.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    host.remove();
    expect(reached).toBe(true);
  });
});
