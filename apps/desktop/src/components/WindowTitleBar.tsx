import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useRef, type MouseEvent as ReactMouseEvent } from "react";
import { productConfig } from "../config/product";
import { t } from "../i18n";

const appWindow = getCurrentWindow();

async function runWindowAction(name: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    console.error(`[window] ${name} failed`, error);
  }
}

export function WindowTitleBar() {
  const mouseDownToggleAt = useRef(0);
  const toggleMaximize = () => void runWindowAction("toggle maximize", () => appWindow.toggleMaximize());
  const minimize = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.currentTarget.blur();
    void runWindowAction("minimize", () => appWindow.minimize());
  };
  const handleDragMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.detail !== 2) return;
    event.preventDefault();
    event.stopPropagation();
    mouseDownToggleAt.current = performance.now();
    toggleMaximize();
  };
  const handleDragDoubleClick = () => {
    if (performance.now() - mouseDownToggleAt.current < 500) return;
    toggleMaximize();
  };
  return (
    <header className="titlebar">
      <div
        className="titlebar-drag-region"
        data-tauri-drag-region
        onMouseDown={handleDragMouseDown}
        onDoubleClick={handleDragDoubleClick}
      >
        <div className="titlebar-brand"><span className="brand-mark" />{productConfig.name}</div>
      </div>
      <div className="titlebar-actions">
        <button type="button" aria-label={t("shell.window.minimize")} onClick={minimize}><Minus size={15} /></button>
        <button type="button" aria-label={t("shell.window.maximize")} onClick={() => void runWindowAction("toggle maximize", () => appWindow.toggleMaximize())}><Square size={12} /></button>
        <button type="button" className="close" aria-label={t("shell.window.close")} onClick={() => void runWindowAction("close", () => appWindow.close())}><X size={16} /></button>
      </div>
    </header>
  );
}
