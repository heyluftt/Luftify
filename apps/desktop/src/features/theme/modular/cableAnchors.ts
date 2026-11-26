import type { Point } from "./patchCable";

const COLOURS = ["#f4c542", "#4c8dff", "#f0544f", "#ff8a3d", "#45d483", "#e9e8e1"];

function colourFor(element: Element): string {
  const key = element.getAttribute("href") ?? element.textContent ?? "";
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return COLOURS[Math.abs(hash) % COLOURS.length]!;
}

/** The jack of the active entry: a main nav item, else the open playlist row. */
export function cableTarget(): { point: Point; colour: string } | null {
  const nav = document.querySelector<HTMLElement>(".sidebar-nav .nav-item.active");
  const entry = nav ? null : document.querySelector<HTMLElement>(".sidebar-library-list .sidebar-entry.active");
  const element = nav ?? entry;
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  if (entry) {
    const list = entry.closest(".sidebar-library-list")?.getBoundingClientRect();
    const centre = rect.top + rect.height / 2;
    if (list && (centre < list.top + 4 || centre > list.bottom - 4)) return null;
  }
  const collapsed = document.querySelector(".app-frame.sidebar-collapsed") !== null;
  const inset = collapsed ? 4 : entry ? 14 : 16;
  return { point: { x: rect.right - inset, y: rect.top + rect.height / 2 }, colour: colourFor(element) };
}

/** The IN jack sits in the gap left of the content module, below the top bar. */
export function inJackPoint(): Point | null {
  const shell = document.querySelector(".content-shell")?.getBoundingClientRect();
  if (!shell || shell.width === 0) return null;
  return { x: shell.left - 4, y: shell.top + 76 };
}
