import { describe, expect, it } from "vitest";
import {
  applyNavigation,
  canNavigateBack,
  canNavigateForward,
  createNavigationHistory,
} from "../src/layouts/navigationHistory";

describe("in-app navigation history", () => {
  it("enables back after a push and forward after a pop", () => {
    let history = createNavigationHistory("/");
    expect(canNavigateBack(history)).toBe(false);
    expect(canNavigateForward(history)).toBe(false);

    history = applyNavigation(history, "/search", "PUSH");
    history = applyNavigation(history, "/library", "PUSH");
    expect(canNavigateBack(history)).toBe(true);
    expect(canNavigateForward(history)).toBe(false);

    history = applyNavigation(history, "/search", "POP");
    expect(canNavigateBack(history)).toBe(true);
    expect(canNavigateForward(history)).toBe(true);

    history = applyNavigation(history, "/queue", "PUSH");
    expect(canNavigateForward(history)).toBe(false);
    expect(history.stack).toEqual(["/", "/search", "/queue"]);
  });

  it("replaces the current entry without growing the stack", () => {
    let history = applyNavigation(
      createNavigationHistory("/"),
      "/settings",
      "PUSH",
    );
    history = applyNavigation(history, "/diagnostics", "REPLACE");
    expect(history.stack).toEqual(["/", "/diagnostics"]);
    expect(canNavigateBack(history)).toBe(true);
  });
});
