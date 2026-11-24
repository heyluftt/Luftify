import { backend, type SetupInfo } from "./backend";
import { german, text } from "./texts";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
document.documentElement.lang = german ? "de" : "en";

const rows = [1, 2, 3, 4].map((hue) => `<div class="row piece"><i class="hue-${hue}"></i><span></span></div>`).join("");
const tiles = [2, 3, 4, 5].map((hue) => `<div class="tile piece"><i class="hue-${hue}"></i><span></span></div>`).join("");

app.innerHTML = `
  <header class="bar" data-tauri-drag-region>
    <span class="planet"></span><b>Luftify</b> ${text.setup}
    <button type="button" class="bar-button" id="minimize" aria-label="${text.minimize}" title="${text.minimize}">–</button>
    <button type="button" class="bar-button" id="close" aria-label="${text.close}" title="${text.close}">×</button>
  </header>
  <main class="left">
    <span class="planet"></span>
    <h1 id="title"></h1>
    <p class="sub" id="sub"></p>
    <div class="progress" id="progress" hidden><b id="percent">0 %</b><span id="step"></span></div>
    <button type="button" class="action" id="action"></button>
    <button type="button" class="link" id="link"></button>
  </main>
  <div class="mini" aria-hidden="true">
    <div class="region side" data-group="0">
      <span class="line on piece"></span><span class="line piece"></span><span class="line piece"></span><span class="line gap piece"></span>
      <div data-group="1">${rows}</div>
    </div>
    <div class="region content" data-group="2">
      <div class="hero piece"><i></i><span></span></div>
      <div class="tiles">${tiles}</div>
    </div>
    <div class="region player" data-group="3"><i class="hue-1 piece"></i><u class="piece"></u><em class="piece"></em></div>
  </div>`;

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const title = get("title"), sub = get("sub"), progress = get("progress"), percent = get("percent"), step = get("step");
const action = get<HTMLButtonElement>("action"), link = get<HTMLButtonElement>("link"), close = get<HTMLButtonElement>("close");

type Phase = "idle" | "installing" | "done" | "failed";
let phase: Phase = "idle";
let info: SetupInfo;
let folder = "";

const THRESHOLDS = [3, 28, 54, 80];

function showGroup(index: number) {
  const group = document.querySelector<HTMLElement>(`[data-group="${index}"]`);
  if (!group || group.dataset.shown) return;
  group.dataset.shown = "true";
  group.closest(".region")?.classList.add("in");
  const pieces = [...group.querySelectorAll<HTMLElement>(".piece")].filter((piece) => piece.closest("[data-group]") === group);
  pieces.forEach((piece, order) => window.setTimeout(() => piece.classList.add("in"), order * 90));
}

function resetMini() {
  document.querySelectorAll<HTMLElement>("[data-group]").forEach((group) => { delete group.dataset.shown; });
  document.querySelectorAll(".region.in, .piece.in").forEach((element) => element.classList.remove("in"));
}

function render() {
  document.body.dataset.phase = phase;
  title.textContent = phase === "failed" ? text.failed : phase === "done" ? text.ready : info.installed ? text.update : text.install;
  sub.textContent = text.version.replace("{version}", info.version).replace("{size}", info.sizeMb.toFixed(0));
  sub.title = folder;
  sub.hidden = phase === "installing" || phase === "done";
  progress.hidden = phase === "idle" || phase === "failed";
  action.disabled = phase === "installing";
  action.textContent = phase === "installing" ? text.busy
    : phase === "done" ? `▶ ${text.start}`
    : phase === "failed" ? text.retry
    : info.installed ? text.goUpdate : text.go;
  link.hidden = phase === "installing" || phase === "done" || (phase === "idle" && info.installed);
  link.textContent = phase === "failed" ? text.classic : text.folder;
  close.disabled = phase === "installing";
}

async function install() {
  phase = "installing";
  resetMini();
  render();
  let outcome: "running" | "ok" | "failed" = "running";
  backend.install(folder).then(() => { outcome = "ok"; }, () => { outcome = "failed"; });

  const started = performance.now();
  let shown = 0;
  const tick = () => {
    if (outcome === "failed") {
      phase = "failed";
      resetMini();
      render();
      return;
    }
    // Creeps towards 92 % while the installer runs, then finishes quickly.
    const creeping = 92 * (1 - Math.exp(-(performance.now() - started) / 3_200));
    shown = outcome === "ok" ? Math.min(100, shown + 1.6) : Math.max(shown, creeping);
    percent.textContent = `${Math.round(shown)} %`;
    const current = THRESHOLDS.reduce((last, threshold, index) => shown >= threshold ? index : last, 0);
    THRESHOLDS.forEach((threshold, index) => { if (shown >= threshold) showGroup(index); });
    step.textContent = text.steps[current] ?? "";
    if (shown < 100) {
      requestAnimationFrame(tick);
      return;
    }
    phase = "done";
    step.textContent = text.done;
    render();
    action.focus();
  };
  requestAnimationFrame(tick);
}

action.addEventListener("click", () => {
  if (phase === "done") void backend.launch(folder);
  else if (phase !== "installing") void install();
});

link.addEventListener("click", async () => {
  if (phase === "failed") {
    void backend.classic();
    return;
  }
  const picked = await backend.pickFolder(folder);
  if (picked) {
    folder = picked;
    render();
  }
});

close.addEventListener("click", () => backend.close());
get("minimize").addEventListener("click", () => backend.minimize());

// Keyboard focus rings only after real keyboard use.
window.addEventListener("keydown", (event) => { if (event.key === "Tab") document.body.classList.add("keys"); });
window.addEventListener("pointerdown", () => document.body.classList.remove("keys"));

void backend.info().then((result) => {
  info = result;
  folder = result.folder;
  render();
  action.focus();
  requestAnimationFrame(() => document.body.classList.add("ready"));
});
