import { t } from "../../../i18n";

export interface Point { x: number; y: number }

const NS = "http://www.w3.org/2000/svg";
const REPATCH_MS = 420;
const LIFT = 60;
/** Spring of the sag: stiffness and damping. */
const STIFF = 55;
const DAMP = 4.2;

function element<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function ease(u: number) {
  return u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
}

/**
 * One patch cable from a plug (moving) to the IN jack (fixed), drawn in an
 * SVG. The sag is a damped spring, so the cable swings after a move and on
 * bass hits.
 */
export function createPatchCable(svg: SVGSVGElement, onPlugged: (at: Point) => void) {
  const group = element("g", {});
  const shadow = element("path", { fill: "none", stroke: "rgb(0 0 0 / 55%)", "stroke-width": 7, "stroke-linecap": "round", transform: "translate(2 4)" });
  const body = element("path", { fill: "none", "stroke-width": 4.5, "stroke-linecap": "round" });
  const shine = element("path", { fill: "none", stroke: "rgb(255 255 255 / 30%)", "stroke-width": 1.2, "stroke-linecap": "round", transform: "translate(-.7 -1.4)" });
  const jack = element("circle", { r: 8, fill: "url(#md-jack)" });
  const label = element("text", { "text-anchor": "middle", "font-size": 8, "font-weight": 600, "letter-spacing": 1.4, fill: "#8f9298", "font-family": "Barlow Condensed, Barlow, sans-serif" });
  label.textContent = t("modular.jackIn");
  const plugIn = element("g", {});
  const plugOut = element("g", {});
  for (const plug of [plugIn, plugOut]) {
    plug.append(element("circle", { r: 6.5, fill: "#151618", "stroke-width": 2 }), element("circle", { r: 2.3 }));
  }
  group.append(shadow, body, shine, plugIn, plugOut);
  svg.append(jack, label, group);

  let target: Point | null = null;
  let inJack: Point = { x: 0, y: 0 };
  let plug: Point = { x: 0, y: 0 };
  let sag = 0;
  let speed = 0;
  let move: { from: Point; started: number; plugs: boolean } | undefined;
  let hidden = true;

  // loose end hangs in the gap beside the content, clear of the nav jacks
  const dangling = (): Point => ({ x: inJack.x + 12 + sag * 0.5, y: inJack.y + 120 });
  const goal = () => target ?? dangling();

  const colour = (value: string) => {
    body.setAttribute("stroke", value);
    for (const plugNode of [plugIn, plugOut]) {
      plugNode.children[0]!.setAttribute("stroke", value);
      plugNode.children[1]!.setAttribute("fill", value);
    }
  };

  const render = () => {
    for (const node of [group, jack, label]) node.classList.toggle("is-hidden", hidden);
    if (hidden) return;
    const a = plug;
    const b = inJack;
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    // slack: the loop hangs below the lower jack and swings sideways with the spring
    const lowest = Math.max(a.y, b.y) + 30 + span * 0.22 + sag;
    const sway = sag * 0.45;
    const d = `M${a.x} ${a.y} C${a.x + 12 + sway} ${lowest} ${b.x + 18 + sway} ${lowest} ${b.x} ${b.y}`;
    body.setAttribute("d", d);
    shadow.setAttribute("d", d);
    shine.setAttribute("d", d);
    plugOut.setAttribute("transform", `translate(${a.x} ${a.y})`);
    plugIn.setAttribute("transform", `translate(${b.x} ${b.y})`);
  };

  return {
    /** Where the IN jack sits; called on every layout change. */
    setInJack(point: Point) {
      inJack = point;
      jack.setAttribute("cx", String(point.x));
      jack.setAttribute("cy", String(point.y));
      label.setAttribute("x", String(point.x));
      label.setAttribute("y", String(point.y + 19));
      if (!move && !target) plug = dangling();
    },
    /** Plug into `next` (null: hang loose). `from` starts the move elsewhere. */
    patch(next: Point | null, nextColour: string, from?: Point) {
      const start = from ?? plug;
      target = next;
      colour(nextColour);
      hidden = false;
      move = { from: start, started: performance.now(), plugs: next !== null };
    },
    /** Follow a layout change without a visible move. */
    settle(next: Point | null) {
      target = next;
      if (!move) plug = goal();
    },
    hide() { hidden = true; move = undefined; render(); },
    /** Put it in place without a move. */
    place(next: Point | null, nextColour: string) {
      target = next;
      colour(nextColour);
      hidden = false;
      move = undefined;
      plug = goal();
    },
    get hidden() { return hidden; },
    /** Already plugged into `next`. */
    isAt(next: Point | null) {
      return next && target ? Math.abs(next.x - target.x) < 1 && Math.abs(next.y - target.y) < 1 : next === target;
    },
    kick(amount: number) { speed += amount; },
    busy() { return Boolean(move) || Math.abs(speed) > 0.3 || Math.abs(sag) > 0.3; },
    step(seconds: number, now: number) {
      if (move) {
        const u = Math.min(1, (now - move.started) / REPATCH_MS);
        const end = goal();
        const e = ease(u);
        plug = { x: move.from.x + (end.x - move.from.x) * e, y: move.from.y + (end.y - move.from.y) * e - LIFT * Math.sin(Math.PI * u) };
        if (u >= 1) {
          const plugged = move.plugs;
          move = undefined;
          speed += 130;
          if (plugged) onPlugged(end);
        }
      } else {
        plug = goal();
      }
      speed += (-STIFF * sag - DAMP * speed) * seconds;
      sag += speed * seconds;
      render();
    },
  };
}

export type PatchCable = ReturnType<typeof createPatchCable>;
