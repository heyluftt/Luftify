import { ChevronDown } from "lucide-react";
import { useId, type ReactNode } from "react";

/**
 * One part of the look as a row: its name, what is chosen and a small
 * preview. Opening it shows the choices; the editor keeps one open at a time.
 */
export function LookSection({ id, icon, title, value, preview, open, onToggle, children }: {
  id: string;
  icon?: ReactNode;
  title: string;
  /** The current choice in words. */
  value: string;
  preview?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `${useId()}-look-${id}`;
  return <section className="look-section" data-open={open || undefined}>
    <button type="button" className="look-section-head" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
      {icon && <span className="look-section-icon" aria-hidden="true">{icon}</span>}
      <span className="look-section-copy"><strong>{title}</strong><small>{value}</small></span>
      {preview && <span className="look-section-preview" aria-hidden="true">{preview}</span>}
      <ChevronDown className="look-section-chevron" size={17} aria-hidden="true" />
    </button>
    {open && <div id={panelId} className="look-section-body">{children}</div>}
  </section>;
}
