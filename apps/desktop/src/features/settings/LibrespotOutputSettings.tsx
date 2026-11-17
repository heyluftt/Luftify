import { Headphones, RefreshCw } from "lucide-react";
import { t } from "../../i18n";
import type { AudioOutputDevice } from "../../types/tauri";
import { SelectRow } from "./SettingsPrimitives";

export function LibrespotOutputSettings({
  enabled,
  selected,
  outputs,
  loading,
  failed,
  switching,
  onRefresh,
  onSelect,
}: {
  enabled: boolean;
  selected: string;
  outputs: AudioOutputDevice[];
  loading: boolean;
  failed: boolean;
  switching: boolean;
  onRefresh: () => void;
  onSelect: (device: string | null) => void;
}) {
  const known = outputs.some((device) => device.name === selected);
  const defaultDevice = outputs.find((device) => device.isDefault);
  return (
    <div className="settings-output-group">
      <div className="settings-list">
        <SelectRow
          icon={Headphones}
          label={t("settings.output.label")}
          description={t("settings.output.hint")}
          disabled={!enabled || switching}
          value={selected}
          onChange={(value) => onSelect(value || null)}
        >
          <option value="">{defaultDevice ? t("settings.output.defaultNamed", { name: defaultDevice.name }) : t("settings.output.default")}</option>
          {selected && !known && (
            <option value={selected}>{loading || failed ? selected : t("settings.output.missing", { name: selected })}</option>
          )}
          {outputs.map((device) => (
            <option key={device.name} value={device.name}>
              {device.isDefault ? t("settings.output.defaultSuffix", { name: device.name }) : device.name}
            </option>
          ))}
        </SelectRow>
      </div>
      <p className="settings-inline-hint">
        {enabled
          ? switching
            ? t("settings.output.switching")
            : failed
            ? t("settings.output.error")
            : loading
            ? t("settings.output.reading")
            : selected && !known
              ? t("settings.output.fallback")
              : outputs.length === 0
              ? t("settings.output.empty")
              : t("settings.output.filterHint")
          : t("settings.output.libreOnly")}
      </p>
      <button
        type="button"
        className="secondary-button"
        disabled={loading || switching}
        onClick={onRefresh}
      >
        <RefreshCw size={15} />{t("settings.output.refresh")}
      </button>
    </div>
  );
}
