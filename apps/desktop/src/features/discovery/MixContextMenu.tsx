import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface MixMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

const MENU_WIDTH = 208;
const ITEM_HEIGHT = 38;

export function MixContextMenu({ x, y, items, onClose }: {
  x: number; y: number; items: MixMenuItem[]; onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const buttons = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    buttons()[0]?.focus();
    const restore = () => { if (previous instanceof HTMLElement) previous.focus(); };
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        onClose();
        restore();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const list = buttons();
      const index = list.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      list[(index + step + list.length) % list.length]?.focus();
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", keyboard);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  const height = items.length * ITEM_HEIGHT + 12;
  return createPortal(<div ref={menu} className="mix-context-menu" role="menu"
    onContextMenu={(event) => event.preventDefault()}
    style={{
      left: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    }}>
    {items.map((item) => <button key={item.label} type="button" role="menuitem" disabled={item.disabled}
      className={item.danger ? "is-danger" : undefined}
      onClick={() => { onClose(); item.onSelect(); }}>{item.label}</button>)}
  </div>, document.body);
}
