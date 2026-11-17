import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowActions = vi.hoisted(() => ({
  minimize: vi.fn<() => Promise<void>>(),
  toggleMaximize: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => Promise<void>>(),
}));

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => windowActions }));

import { WindowTitleBar } from "../src/components/WindowTitleBar";

describe("WindowTitleBar", () => {
  beforeEach(() => {
    windowActions.minimize.mockReset().mockResolvedValue(undefined);
    windowActions.toggleMaximize.mockReset().mockResolvedValue(undefined);
    windowActions.close.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("routes all window buttons through the current Tauri window", () => {
    render(<WindowTitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "Fenster minimieren" }));
    fireEvent.click(screen.getByRole("button", { name: "Fenster maximieren oder wiederherstellen" }));
    fireEvent.click(screen.getByRole("button", { name: "Fenster schließen" }));
    expect(windowActions.minimize).toHaveBeenCalledOnce();
    expect(windowActions.toggleMaximize).toHaveBeenCalledOnce();
    expect(windowActions.close).toHaveBeenCalledOnce();
  });

  it("releases the minimize button focus before hiding the window", () => {
    render(<WindowTitleBar />);
    const minimize = screen.getByRole("button", { name: "Fenster minimieren" });
    minimize.focus();

    fireEvent.click(minimize);

    expect(minimize).not.toHaveFocus();
    expect(windowActions.minimize).toHaveBeenCalledOnce();
  });

  it("toggles maximize on a double click in the free drag region", () => {
    const { container } = render(<WindowTitleBar />);
    fireEvent.doubleClick(container.querySelector("[data-tauri-drag-region]") as Element);
    expect(windowActions.toggleMaximize).toHaveBeenCalledOnce();
  });

  it("handles the second physical mouse-down before the native drag hook", () => {
    const { container } = render(<WindowTitleBar />);
    const dragRegion = container.querySelector("[data-tauri-drag-region]") as Element;
    fireEvent.mouseDown(dragRegion, { button: 0, detail: 2 });
    fireEvent.doubleClick(dragRegion);
    expect(windowActions.toggleMaximize).toHaveBeenCalledOnce();
  });

  it("catches and logs rejected Tauri operations", async () => {
    const error = new Error("denied");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    windowActions.close.mockRejectedValueOnce(error);
    render(<WindowTitleBar />);
    fireEvent.click(screen.getByRole("button", { name: "Fenster schließen" }));
    await waitFor(() => expect(consoleError).toHaveBeenCalledWith("[window] close failed", error));
  });
});
