const RESTORE_WINDOW_MS = 1_500;

/**
 * Brings a page back to where it was left. On "Back" the page is usually
 * not complete yet (lazy chunk, data, virtual rows), so a single
 * `scrollTop = saved` lands too high. This keeps retrying while the
 * content grows, for a short time only, and gives up as soon as the user
 * scrolls. Returns a cleanup.
 */
export function restoreScroll(scroller: HTMLElement, target: number): () => void {
  if (target <= 0) {
    scroller.scrollTop = 0;
    return () => undefined;
  }

  let done = false;
  const apply = () => {
    if (done) return;
    scroller.scrollTop = target;
    if (Math.abs(scroller.scrollTop - target) < 2) finish();
  };
  const finish = () => {
    if (done) return;
    done = true;
    resize?.disconnect();
    mutations?.disconnect();
    window.clearTimeout(timeout);
    for (const type of USER_SCROLL_EVENTS) scroller.removeEventListener(type, finish);
  };

  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(apply) : undefined;
  const observeChildren = () => {
    for (const child of Array.from(scroller.children)) resize?.observe(child);
  };
  // The loading state is replaced by the real page while we wait.
  const mutations = resize && typeof MutationObserver === "function"
    ? new MutationObserver(() => { observeChildren(); apply(); })
    : undefined;
  observeChildren();
  mutations?.observe(scroller, { childList: true });
  for (const type of USER_SCROLL_EVENTS) scroller.addEventListener(type, finish, { passive: true });
  const timeout = window.setTimeout(finish, RESTORE_WINDOW_MS);
  apply();
  return finish;
}

const USER_SCROLL_EVENTS = ["wheel", "pointerdown", "keydown", "touchstart"] as const;
