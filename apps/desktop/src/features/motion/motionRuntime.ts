export function enableMotionAfterFirstPaint(): void {
  const root = document.documentElement;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      root.classList.add("motion-ready");
    });
  });
}
