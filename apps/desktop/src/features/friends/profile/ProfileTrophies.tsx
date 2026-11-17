import { t } from "../../../i18n";
import { ACHIEVEMENTS, ACHIEVEMENT_INFO, achievementName } from "../achievements/achievements";

/** The achievements as a quiet row of symbols: reached ones in colour, the rest faint. */
export function ProfileTrophies({ achievements }: { achievements: string[] | undefined }) {
  const reached = new Set(achievements ?? []);
  return <div className="profile-trophies" aria-label={t("profileLook.trophies", { n: reached.size, total: ACHIEVEMENTS.length })}>
    <small>{t("achievements.tab")} · {reached.size}/{ACHIEVEMENTS.length}</small>
    <ul>{ACHIEVEMENTS.map((id) => {
      const { icon: Icon, color } = ACHIEVEMENT_INFO[id];
      const done = reached.has(id);
      return <li key={id} data-badge-color={color} data-done={done || undefined} title={t(achievementName(id))}>
        <Icon size={14} aria-hidden="true" /><span className="sr-only">{t(achievementName(id))}</span>
      </li>;
    })}</ul>
  </div>;
}
