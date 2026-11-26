import { Cable, Check, Feather, Gamepad2, Gauge, Gem, Leaf, ListMusic, Moon, Palette, Sparkles, Star, Sun, Waves, Wind, Zap, type LucideIcon } from "lucide-react";
import { t, type MessageKey } from "../../i18n";
import { useAbyssMusic } from "../theme/abyss/abyssMusic";
import { AerisPreview } from "../theme/aeris/AerisPreview";
import { usePixelpopMusic } from "../theme/pixelpop/pixelpopMusic";
import { PixelpopPreview } from "../theme/pixelpop/PixelpopPreview";
import { useModularMusic } from "../theme/modular/modularMusic";
import { ModularPreview } from "../theme/modular/ModularPreview";
import { useMotionChoice, type MotionChoice } from "../motion/motionLevel";
import { SectionHeading, SelectRow, SettingsGroup, ToggleRow } from "./SettingsPrimitives";

const themes: Array<[string, MessageKey, LucideIcon]> = [
  ["dark", "settings.theme.dark", Moon],
  ["light", "settings.theme.light", Sun],
  ["atelier", "settings.theme.atelier", Leaf],
  ["luft", "settings.theme.luft", Palette],
  ["redline", "settings.theme.redline", Gauge],
  ["rose", "settings.theme.rose", Sparkles],
  ["polaris", "settings.theme.polaris", Star],
  ["prisma", "settings.theme.prisma", Gem],
  ["calamus", "settings.theme.calamus", Feather],
  ["abyss", "settings.theme.abyss", Waves],
  ["aeris", "settings.theme.aeris", Wind],
  ["pixelpop", "settings.theme.pixelpop", Gamepad2],
  ["modular", "settings.theme.modular", Cable],
];

export function AppearanceSettings({
  selected,
  nowPlayingListNavigationEnabled,
  onSelect,
  onNowPlayingListNavigationEnabled,
}: {
  selected: string;
  nowPlayingListNavigationEnabled: boolean;
  onSelect: (theme: string) => void;
  onNowPlayingListNavigationEnabled: (enabled: boolean) => void;
}) {
  return (
    <section id="settings-appearance" className="settings-section">
      <SectionHeading index="02" title={t("settings.appearance.title")} />
      <div className="theme-options">
        {themes.map(([id, labelKey, Icon]) => (
          <button type="button" key={id} data-theme-option={id} aria-pressed={selected === id} className={selected === id ? "theme-option active" : "theme-option"} onClick={() => onSelect(id)}>
            {id === "aeris" ? <AerisPreview /> : id === "pixelpop" ? <PixelpopPreview /> : id === "modular" ? <ModularPreview /> : <span className="theme-preview" aria-hidden="true"><i /><i /><i /></span>}
            <span className="theme-option-copy"><Icon /><strong>{t(labelKey)}</strong></span>
            {selected === id && <span className="theme-selected-label"><Check />{t("settings.theme.active")}</span>}
          </button>
        ))}
      </div>
      {selected === "abyss" && <AbyssMusicToggle />}
      {selected === "pixelpop" && <PixelpopMusicToggle />}
      {selected === "modular" && <ModularMusicToggle />}
      <SettingsGroup title={t("settings.lists.title")}>
        <div className="settings-list">
          <ToggleRow
            icon={ListMusic}
            label={t("settings.lists.highlight")}
            description={t("settings.lists.highlightHint")}
            checked={nowPlayingListNavigationEnabled}
            onChange={onNowPlayingListNavigationEnabled}
          />
        </div>
      </SettingsGroup>
      <MotionSettings />
    </section>
  );
}

function AbyssMusicToggle() {
  const { enabled, set } = useAbyssMusic();
  return <div className="settings-list theme-extra">
    <ToggleRow icon={Waves} label={t("settings.theme.abyssMusic")} checked={enabled} onChange={set} />
  </div>;
}

function PixelpopMusicToggle() {
  const { enabled, set } = usePixelpopMusic();
  return <div className="settings-list theme-extra">
    <ToggleRow icon={Gamepad2} label={t("settings.theme.pixelpopMusic")} checked={enabled} onChange={set} />
  </div>;
}

function ModularMusicToggle() {
  const { enabled, set } = useModularMusic();
  return <div className="settings-list theme-extra">
    <ToggleRow icon={Cable} label={t("settings.theme.modularMusic")} checked={enabled} onChange={set} />
  </div>;
}

const motionChoices: MotionChoice[] = ["system", "full", "subtle", "off"];

function MotionSettings() {
  const { choice, set } = useMotionChoice();
  return (
    <SettingsGroup title={t("settings.motion.title")}>
      <div className="settings-list">
        <SelectRow icon={Zap} label={t("settings.motion.label")} value={choice} onChange={set}>
          {motionChoices.map((value) => <option key={value} value={value}>{t(`settings.motion.${value}`)}</option>)}
        </SelectRow>
      </div>
    </SettingsGroup>
  );
}
