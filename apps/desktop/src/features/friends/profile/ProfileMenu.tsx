import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../../../i18n";

export interface ProfileMenuItem { icon: LucideIcon; label: string; danger?: boolean; disabled?: boolean; onSelect: () => void }

const GAP = 6;

/**
 * Less frequent actions behind "…". The list floats above the dialog (so the
 * dialog never has to scroll for it) and opens upwards when below is short.
 */
export function ProfileMenu({ items }: { items: ProfileMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !button.current || !list.current) return;
    const anchor = button.current.getBoundingClientRect();
    const { width, height } = list.current.getBoundingClientRect();
    const below = anchor.bottom + GAP + height <= window.innerHeight - GAP;
    setPosition({
      left: Math.min(Math.max(GAP, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - GAP),
      top: below ? anchor.bottom + GAP : Math.max(GAP, anchor.top - GAP - height),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !button.current?.contains(target)) close();
    };
    // On window, before the dialog's own Escape handler on document.
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("resize", close);
    // Scrolling the dialog would leave the list floating off its button.
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return <>
    <button ref={button} type="button" className="friends-icon-button profile-menu-button" aria-haspopup="menu" aria-expanded={open}
      title={t("friendProfile.more")} aria-label={t("friendProfile.more")} onClick={() => { setPosition(null); setOpen(!open); }}>
      <MoreHorizontal size={18} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={list} className="profile-menu-list" role="menu"
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden", left: 0, top: 0 }}>
      {items.map(({ icon: Icon, label, danger, disabled, onSelect }) => <button key={label} type="button" role="menuitem"
        data-danger={danger || undefined} disabled={disabled} onClick={() => { setOpen(false); onSelect(); }}>
        <Icon size={15} aria-hidden="true" />{label}
      </button>)}
    </div>, document.body)}
  </>;
}
