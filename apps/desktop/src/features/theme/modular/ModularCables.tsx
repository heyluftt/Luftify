import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { prefersLessMotion } from "../../motion/motionLevel";
import type { MusicLevels } from "../useMusicLevels";
import { cableTarget, inJackPoint } from "./cableAnchors";
import { createPatchCable, type PatchCable, type Point } from "./patchCable";

const SIGNAL_MS = 520;
const POWER_PLUG_DELAY_MS = 380;
const REFRESH_MS = 600;

function flash(at: Point) {
  const spark = document.createElement("i");
  spark.className = "modular-flash";
  spark.style.left = `${at.x}px`;
  spark.style.top = `${at.y}px`;
  document.body.appendChild(spark);
  window.setTimeout(() => spark.remove(), 400);
}

function signal() {
  const root = document.documentElement;
  root.removeAttribute("data-md-signal");
  void root.offsetWidth;
  root.setAttribute("data-md-signal", "");
  window.setTimeout(() => root.removeAttribute("data-md-signal"), SIGNAL_MS);
}

/** The patch cable over the shell: active entry → IN jack of the content module. */
export function ModularCables({ levels }: { levels: MusicLevels }) {
  const svg = useRef<SVGSVGElement>(null);
  const cable = useRef<PatchCable | undefined>(undefined);
  const wake = useRef<() => void>(() => undefined);
  const { pathname } = useLocation();
  const shownPath = useRef(pathname);

  useEffect(() => {
    const host = svg.current;
    if (!host) return;
    const root = document.documentElement;
    const patch = createPatchCable(host, (at) => { if (!prefersLessMotion()) flash(at); });
    cable.current = patch;
    let frame = 0;
    let last = 0;
    let lastBass = 0;
    let writtenBass = -1;
    let bassNodes: HTMLElement[] = [];

    const layout = () => {
      // fullscreen lyrics hide the sidebar, so no cable either
      const sidebar = document.querySelector(".sidebar")?.getBoundingClientRect();
      host.classList.toggle("is-off", !sidebar || sidebar.width === 0);
      const jack = inJackPoint();
      if (jack) patch.setInJack(jack);
      if (!patch.hidden) patch.settle(cableTarget()?.point ?? null);
      bassNodes = [...document.querySelectorAll<HTMLElement>(".brand-md-led, .sidebar-entry.is-playing")];
    };
    const writeBass = (bass: number) => {
      if (Math.abs(bass - writtenBass) < 0.04) return;
      writtenBass = bass;
      for (const node of bassNodes) node.style.setProperty("--md-bass", bass.toFixed(2));
    };
    const tick = (now: number) => {
      frame = 0;
      if (document.hidden || root.hasAttribute("data-window-idle")) return;
      const seconds = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      if (levels.bass > lastBass + 0.25) patch.kick(40 * levels.bass);
      lastBass = levels.bass;
      writeBass(levels.bass);
      patch.step(seconds, now);
      if (patch.busy() || levels.energy > 0.02 || levels.bass > 0.02) frame = window.requestAnimationFrame(tick);
    };
    const start = () => {
      if (prefersLessMotion()) { patch.step(0, performance.now()); return; }
      if (frame) return;
      last = performance.now();
      frame = window.requestAnimationFrame(tick);
    };
    wake.current = start;

    const plugFromBelow = () => {
      layout();
      const jack = inJackPoint();
      const target = cableTarget();
      if (!jack) return;
      if (prefersLessMotion()) patch.place(target?.point ?? null, target?.colour ?? "#e9e8e1");
      else patch.patch(target?.point ?? null, target?.colour ?? "#e9e8e1", { x: jack.x - 10, y: jack.y + 220 });
      start();
    };

    layout();
    let powerTimer = 0;
    let startTimer = 0;
    if (root.hasAttribute("data-start")) patch.hide();
    else if (root.hasAttribute("data-md-power")) { patch.hide(); powerTimer = window.setTimeout(plugFromBelow, POWER_PLUG_DELAY_MS); }
    else {
      const target = cableTarget();
      patch.place(target?.point ?? null, target?.colour ?? "#e9e8e1");
      patch.step(0, performance.now());
    }

    const startWatch = new MutationObserver(() => {
      if (root.hasAttribute("data-start")) { patch.hide(); return; }
      if (patch.hidden) { window.clearTimeout(startTimer); startTimer = window.setTimeout(plugFromBelow, 150); }
    });
    startWatch.observe(root, { attributes: true, attributeFilter: ["data-start"] });
    const resize = new ResizeObserver(() => { layout(); start(); });
    for (const selector of [".content-shell", ".sidebar"]) {
      const node = document.querySelector(selector);
      if (node) resize.observe(node);
    }
    const list = document.querySelector(".sidebar-library-list");
    const onScroll = () => { layout(); patch.step(0, performance.now()); };
    list?.addEventListener("scroll", onScroll, { passive: true });
    // the sidebar fills in late (library), and music can start any time
    const refresh = window.setInterval(() => {
      if (document.hidden || root.hasAttribute("data-window-idle")) return;
      layout();
      start();
    }, REFRESH_MS);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(powerTimer);
      window.clearTimeout(startTimer);
      window.clearInterval(refresh);
      startWatch.disconnect();
      resize.disconnect();
      list?.removeEventListener("scroll", onScroll);
      host.replaceChildren(...[...host.children].filter((child) => child.tagName === "defs"));
      cable.current = undefined;
    };
  }, [levels]);

  useEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    const patch = cable.current;
    if (!patch || patch.hidden || document.documentElement.hasAttribute("data-start")) return;
    const target = cableTarget();
    if (patch.isAt(target?.point ?? null)) {
      if (!prefersLessMotion()) signal();
      return;
    }
    if (prefersLessMotion()) {
      patch.place(target?.point ?? null, target?.colour ?? "#e9e8e1");
      patch.step(0, performance.now());
      return;
    }
    patch.patch(target?.point ?? null, target?.colour ?? "#e9e8e1");
    signal();
    wake.current();
  }, [pathname]);

  return (
    <svg ref={svg} className="modular-cables" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="md-jack">
          <stop offset="0.42" stopColor="#030303" />
          <stop offset="0.47" stopColor="#a3a6ab" />
          <stop offset="0.64" stopColor="#a3a6ab" />
          <stop offset="0.7" stopColor="#55585e" />
          <stop offset="0.86" stopColor="#55585e" />
          <stop offset="0.92" stopColor="#26282c" />
          <stop offset="1" stopColor="#26282c" />
        </radialGradient>
      </defs>
    </svg>
  );
}
