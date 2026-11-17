import { Check, ChevronDown } from "lucide-react";
import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "../../styles/components/settings-select.css";

export function SettingsSelect({ label, value, onChange, children, compact = false, disabled = false, inline = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  /** Borderless trigger for a toolbar pill that draws its own frame. */
  inline?: boolean;
}) {
  const options = Children.toArray(children).flatMap((child) =>
    isValidElement<{ value: string; children: ReactNode; disabled?: boolean }>(child)
      && child.type === "option" ? [child.props] : []);
  const selected = options.findIndex((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const search = useRef({ text: "", time: 0 });

  const close = () => setOpen(false);
  const choose = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
    trigger.current?.focus({ preventScroll: true });
  };
  const move = (direction: number) => {
    for (let step = 1; step <= options.length; step++) {
      const index = (active + direction * step + options.length) % options.length;
      if (options[index] && !options[index]?.disabled) { setActive(index); break; }
    }
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const heightLimit = compact ? 190 : 280;
    const upwards = below < Math.min(heightLimit, options.length * (compact ? 30 : 42) + 12) && above > below;
    const maxHeight = Math.max(40, Math.min(heightLimit, upwards ? above : below));
    const width = Math.min(Math.max(rect.width, compact ? 160 : 260), window.innerWidth - 24);
    if (menu.current) menu.current.style.width = `${width}px`;
    setPosition({
      left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      top: upwards ? rect.top - 6 - Math.min(maxHeight, menu.current?.scrollHeight ?? maxHeight) : rect.bottom + 6,
      width,
      maxHeight,
    });
  }, [open, options.length, compact]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close();
    };
    const scroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    const list = menu.current;
    const option = list?.children[active];
    if (!open || !list || !(option instanceof HTMLElement)) return;
    // scrollIntoView can scroll the page as well, triggering our outside-scroll dismissal.
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [open, active, position.maxHeight]);

  return <>
    <button ref={trigger} type="button" disabled={disabled}
      className={`settings-select-trigger${compact ? " is-compact" : ""}${inline ? " is-inline" : ""}`}
      role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined}
      onClick={() => { setActive(Math.max(0, selected)); setOpen(!open); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { if (open) { event.preventDefault(); event.stopPropagation(); close(); } return; }
        if (event.key === "Tab") { close(); return; }
        if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
          event.preventDefault();
          if (!open) { setActive(Math.max(0, selected)); setOpen(true); return; }
          if (event.key === "ArrowDown") move(1);
          else if (event.key === "ArrowUp") move(-1);
          else if (event.key === "Home") setActive(Math.max(0, options.findIndex((option) => !option.disabled)));
          else if (event.key === "End") {
            for (let index = options.length - 1; index >= 0; index--) {
              if (options[index] && !options[index]?.disabled) { setActive(index); break; }
            }
          } else choose(active);
        } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
          const now = Date.now();
          search.current = { text: (now - search.current.time < 700 ? search.current.text : "") + event.key.toLocaleLowerCase(), time: now };
          const index = options.findIndex((option) => !option.disabled && String(option.children).toLocaleLowerCase().startsWith(search.current.text));
          if (index >= 0) { event.preventDefault(); setActive(index); setOpen(true); }
        }
      }}>
      <span>{options[selected]?.children ?? value}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menu} id={id} role="listbox" aria-label={label}
      className={`settings-select-menu${compact ? " is-compact" : ""}`} style={position}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.preventDefault()}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option"
        aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
        className={`settings-select-option${index === active ? " is-active" : ""}`}
        onPointerMove={() => { if (!option.disabled) setActive(index); }} onClick={() => choose(index)}>
        <span>{option.children}</span>{option.value === value && <Check size={16} aria-hidden="true" />}
      </div>)}
    </div>, document.body)}
  </>;
}
