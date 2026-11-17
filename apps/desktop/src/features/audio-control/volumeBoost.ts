export const MIN_VOLUME_BOOST_PERCENT = 100;
export const MAX_VOLUME_BOOST_PERCENT = 300;
export const DEFAULT_VOLUME_BOOST_PERCENT = 150;
export const VOLUME_BOOST_PERCENT_PRESETS = [125, 150, 200, 300] as const;

const MAX_VOLUME_BOOST_DB = 20 * Math.log10(MAX_VOLUME_BOOST_PERCENT / 100);

export function volumeBoostPercentFromDb(value: number): number {
  const db = Number.isFinite(value) ? Math.min(MAX_VOLUME_BOOST_DB, Math.max(0, value)) : 0;
  return clampVolumeBoostPercent(Math.round(100 * Math.pow(10, db / 20)));
}

export function volumeBoostDbFromPercent(value: number): number {
  const percent = clampVolumeBoostPercent(value);
  return 20 * Math.log10(percent / 100);
}

export function clampVolumeBoostPercent(value: number): number {
  const finite = Number.isFinite(value) ? value : MIN_VOLUME_BOOST_PERCENT;
  return Math.min(MAX_VOLUME_BOOST_PERCENT, Math.max(MIN_VOLUME_BOOST_PERCENT, Math.round(finite)));
}
