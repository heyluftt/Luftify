import { afterEach, expect, it } from "vitest";
import { useUiStore } from "../src/stores/uiStore";

afterEach(() => useUiStore.setState({ recentOpen: false, queueOpen: false, commandPaletteOpen: false }));

it("opens only one of history, queue and command palette", () => {
  const ui = useUiStore.getState();
  ui.setQueueOpen(true);
  ui.setRecentOpen(true);
  expect(useUiStore.getState()).toMatchObject({ recentOpen: true, queueOpen: false, commandPaletteOpen: false });
  ui.setCommandPaletteOpen(true);
  expect(useUiStore.getState()).toMatchObject({ recentOpen: false, queueOpen: false, commandPaletteOpen: true });
  ui.setRecentOpen(true);
  ui.setQueueOpen(true);
  expect(useUiStore.getState()).toMatchObject({ recentOpen: false, queueOpen: true, commandPaletteOpen: false });
});
