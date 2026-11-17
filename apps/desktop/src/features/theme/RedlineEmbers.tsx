import { useEffect, useState } from "react";

const EMBERS = [
  "a", "b", "c", "d", "e", "f", "g", "h",
  "i", "j", "k", "l", "m", "n", "o", "p",
] as const;

const FLAMES = ["a", "b", "c", "d", "e"] as const;

export function RedlineEmbers() {
  const [active, setActive] = useState(
    () => document.documentElement.dataset.theme === "luft.redline",
  );
  const [boot, setBoot] = useState(0);

  useEffect(() => {
    const root = document.documentElement;
    let on = root.dataset.theme === "luft.redline";
    const observer = new MutationObserver(() => {
      const next = root.dataset.theme === "luft.redline";
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
    <div key={boot} className="redline-atmosphere" aria-hidden="true">
      <i className="redline-heat redline-heat-left" />
      <i className="redline-heat redline-heat-right" />
      <i className="redline-bed" />
      {FLAMES.map((id) => (
        <i key={id} className={`redline-flame redline-flame-${id}`} />
      ))}
      <i className="redline-smoke" />
      <i className="redline-ignition" />
      {EMBERS.map((id) => (
        <i key={id} className={`redline-ember redline-ember-${id}`} />
      ))}
    </div>
  );
}
