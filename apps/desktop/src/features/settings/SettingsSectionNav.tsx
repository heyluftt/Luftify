import { Bell, House, Keyboard, MicVocal, MonitorUp, Palette, Radio, Rocket, Search, ShieldCheck, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t, type MessageKey } from "../../i18n";
import { matchesEveryWord } from "../textMatch";
import { prefersLessMotion } from "../motion/motionLevel";

const sections = [
  { target: "settings-playback", labelKey: "settingsUi.nav.playback", icon: Radio },
  { target: "settings-appearance", labelKey: "settings.nav.appearance", icon: Palette },
  { target: "settings-lyrics", labelKey: "settingsUi.nav.lyrics", icon: MicVocal },
  { target: "settings-home", labelKey: "settings.nav.home", icon: House },
  { target: "settings-lifecycle", labelKey: "settingsUi.nav.window", icon: Rocket },
  { target: "settings-miniplayer", labelKey: "settingsUi.nav.miniplayer", icon: MonitorUp },
  { target: "settings-privacy", labelKey: "settingsUi.nav.privacy", icon: ShieldCheck },
  { target: "settings-notifications", labelKey: "settingsUi.nav.notifications", icon: Bell },
  { target: "settings-profile", labelKey: "settingsUi.nav.profile", icon: UserRound },
  { target: "settings-shortcuts", labelKey: "settingsUi.nav.shortcuts", icon: Keyboard },
] as const satisfies ReadonlyArray<{
  target: string;
  labelKey: MessageKey;
  icon: typeof Palette;
}>;

type SettingsSectionTarget = (typeof sections)[number]["target"];

export function settingsFocusSection(hash = typeof window === "undefined" ? "" : window.location.hash): SettingsSectionTarget | undefined {
  const queryIndex = hash.indexOf("?");
  if (queryIndex < 0) return undefined;
  const focus = new URLSearchParams(hash.slice(queryIndex + 1)).get("focus");
  if (focus === "privacy") return "settings-privacy";
  if (focus === "lifecycle") return "settings-lifecycle";
  if (focus === "playback") return "settings-playback";
  if (focus === "profile") return "settings-profile";
  if (focus === "notifications") return "settings-notifications";
  return undefined;
}

function scrollToSettingsSection(
  target: SettingsSectionTarget,
  onActive?: (target: SettingsSectionTarget) => void,
) {
  const section = document.getElementById(target);
  if (!section) return;
  onActive?.(target);
  section.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
}

function reduceMotion() {
  return prefersLessMotion();
}

export function SettingsSectionNav() {
  const navRef = useRef<HTMLElement>(null);
  const [activeTarget, setActiveTarget] = useState<SettingsSectionTarget>(sections[0].target);

  useEffect(() => {
    const focused = settingsFocusSection();
    if (!focused) return;
    const frame = window.requestAnimationFrame(() => {
      scrollToSettingsSection(focused, setActiveTarget);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const navigation = navRef.current;
    const scrollContainer = navigation?.closest<HTMLElement>(".page-scroll");
    if (!navigation || !scrollContainer) return;

    const updateActiveSection = () => {
      const activationLine = scrollContainer.getBoundingClientRect().top + 116;
      let nextTarget: SettingsSectionTarget = sections[0].target;

      for (const { target } of sections) {
        const section = document.getElementById(target);
        if (!section) continue;
        if (section.getBoundingClientRect().top > activationLine) break;
        nextTarget = target;
      }

      const isAtBottom = scrollContainer.scrollHeight > scrollContainer.clientHeight
        && scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 1;
      if (isAtBottom) nextTarget = sections[sections.length - 1]!.target;
      setActiveTarget(nextTarget);
    };

    updateActiveSection();
    scrollContainer.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      scrollContainer.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, []);

  return (
    <>
      <SettingsSearch />
      <nav ref={navRef} className="settings-section-nav" aria-label={t("settings.navAria")}>
        {sections.map(({ target, labelKey, icon: Icon }) => (
          <button
            key={target}
            type="button"
            aria-controls={target}
            aria-current={activeTarget === target ? "location" : undefined}
            onClick={() => scrollToSettingsSection(target, setActiveTarget)}
          >
            <Icon aria-hidden="true" />
            <span>
              <strong>{t(labelKey)}</strong>
            </span>
          </button>
        ))}
      </nav>
    </>
  );
}

/** Anything that names a setting: labels, button texts, shortcut names. */
const LABELS = "strong, .settings-cache-action-label, .shortcut-list li > span";
/** The control a label belongs to, which the search jumps to and marks. */
const TARGETS = [
  ".settings-group-heading",
  ".setting-row",
  "button",
  "a",
  "label",
  "li",
  ".settings-cache-copy",
  ".settings-insight",
  ".settings-actions-panel",
].join(", ");

interface SearchHit {
  label: string;
  section: string;
  element: HTMLElement;
}

/**
 * Finds a setting by its visible label and jumps to it. Reads the labels
 * from the rendered page, so every setting is searchable without a list to
 * keep in sync.
 */
function SettingsSearch() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const highlight = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    const found: SearchHit[] = [];
    const seen = new Set<HTMLElement>();
    for (const label of document.querySelectorAll<HTMLElement>(`.settings-content :is(${LABELS})`)) {
      let row = label.closest<HTMLElement>(TARGETS) ?? label.parentElement;
      if (!row || row.closest(".settings-section-heading")) continue;
      // A group heading stands for its whole group.
      if (row.matches(".settings-group-heading")) row = row.parentElement ?? row;
      if (seen.has(row)) continue;
      const text = label.textContent?.trim() ?? "";
      const detail = row.querySelector("small")?.textContent ?? undefined;
      if (!text || !matchesEveryWord(query, text, detail)) continue;
      seen.add(row);
      const section = row.closest("section.settings-section")?.querySelector("h2")?.textContent ?? "";
      found.push({ label: text, section, element: row });
      if (found.length === 8) break;
    }
    setHits(found);
  }, [query]);

  useEffect(() => () => highlight.current?.classList.remove("is-search-hit"), []);

  const jump = (hit: SearchHit) => {
    highlight.current?.classList.remove("is-search-hit");
    hit.element.classList.add("is-search-hit");
    highlight.current = hit.element;
    hit.element.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
    window.setTimeout(() => hit.element.classList.remove("is-search-hit"), 1_800);
  };

  const empty = useMemo(() => query.trim().length > 0 && hits.length === 0, [hits.length, query]);

  return (
    <div className="settings-search">
      <label className="library-filter">
        <Search size={14} aria-hidden="true" />
        <span className="sr-only">{t("settingsUi.search")}</span>
        <input
          value={query}
          maxLength={60}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("settingsUi.search")}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && hits[0]) jump(hits[0]);
            if (event.key === "Escape" && query) {
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        {query && (
          <button type="button" className="library-filter-clear" aria-label={t("search.clear")} onClick={() => setQuery("")}>
            <X size={13} />
          </button>
        )}
      </label>
      {(hits.length > 0 || empty) && (
        <ul className="settings-search-hits" aria-label={t("settingsUi.search")}>
          {hits.map((hit, index) => (
            <li key={`${hit.label}${index}`}>
              <button type="button" onClick={() => jump(hit)}>
                <strong>{hit.label}</strong>
                <small>{hit.section}</small>
              </button>
            </li>
          ))}
          {empty && <li className="is-empty">{t("settingsUi.searchEmpty")}</li>}
        </ul>
      )}
    </div>
  );
}
