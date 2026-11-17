const INTERACTIVE_TARGETS = [
  "a[href]",
  "button",
  "input",
  "select",
  "summary",
  "textarea",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='button']",
  "[role='checkbox']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='slider']",
  "[role='switch']",
  "[role='textbox']",
].join(",");

export function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_TARGETS) !== null;
}
