import { useEffect, useState } from "react";

const MOTES = [
  "a", "b", "c", "d", "e", "f",
  "g", "h", "i", "j", "k", "l",
] as const;

export function RoseNocturne() {
  const [active, setActive] = useState(
    () => document.documentElement.dataset.theme === "luft.rose",
  );
  const [boot, setBoot] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    let on = root.dataset.theme === "luft.rose";
    const observer = new MutationObserver(() => {
      const next = root.dataset.theme === "luft.rose";
      if (next === on) return;
      on = next;
      if (next) setBoot((value) => value + 1);
      setActive(next);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  if (!active) return null;

  return (
    <div key={boot} className="rose-chamber" aria-hidden="true">
      <i className="rose-velvet" />
      <i className="rose-lamp" />
      <i className="rose-silk" />
      <i className="rose-grain" />
      {MOTES.map((id) => (
        <i key={id} className={`rose-mote rose-mote-${id}`} />
      ))}
    </div>
  );
}
