import { Check, Trophy } from "lucide-react";
import type { CSSProperties } from "react";
import { appLanguage, t } from "../../../i18n";
import type { SocialSnapshot } from "../friendsTypes";
import { QuestBadge } from "../RoleBadge";
import { ACHIEVEMENTS, ACHIEVEMENT_INFO, REWARD_FRAME, achievementHint, achievementName, isAchievement } from "./achievements";

const dateFormat = () => new Intl.DateTimeFormat(appLanguage() === "en" ? "en-GB" : "de-DE", { day: "numeric", month: "long", year: "numeric" });

/** Every achievement with its progress; reached ones show their badge and when. */
export function AchievementsPanel({ snapshot }: { snapshot: SocialSnapshot }) {
  const states = new Map((snapshot.achievementProgress ?? []).map((state) => [state.id, state]));
  const reached = ACHIEVEMENTS.filter((id) => states.get(id)?.unlockedAtMs).length;
  const format = dateFormat();
  return <section className="friends-panel achievements" aria-labelledby="achievements-title">
    <div className="friends-section-heading">
      <div><h2 id="achievements-title">{t("achievements.title")}</h2>
        <p className="friends-muted">{t("achievements.count", { n: reached, max: ACHIEVEMENTS.length })}</p></div>
      <Trophy size={24} aria-hidden="true" />
    </div>
    <ol className="achievements-grid">
      {ACHIEVEMENTS.filter(isAchievement).map((id, index) => {
        const state = states.get(id);
        const done = Boolean(state?.unlockedAtMs);
        const { icon: Icon, color } = ACHIEVEMENT_INFO[id];
        const goal = state?.goal ?? 1;
        const progress = Math.min(goal, state?.progress ?? 0);
        return <li key={id} className="achievement" data-done={done || undefined} data-badge-color={color} style={{ "--i": index } as CSSProperties}>
          <span className="achievement-icon" aria-hidden="true"><Icon size={20} strokeWidth={2.1} />{done && <Check className="achievement-check" size={12} strokeWidth={3} />}</span>
          <span className="achievement-copy">
            <strong>{t(achievementName(id))}</strong>
            <small>{t(achievementHint(id))}</small>
            {done
              ? <small className="achievement-date">{t("achievements.reached", { date: format.format(state!.unlockedAtMs!) })}</small>
              : goal > 1 && <span className="achievement-progress" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={progress}
                aria-label={t(achievementName(id))}><i style={{ width: `${(progress / goal) * 100}%` }} /><small>{progress} / {goal}</small></span>}
          </span>
          <span className="achievement-reward" title={t(id === "collector" ? "achievements.rewardFrame" : "achievements.reward")}>
            <QuestBadge quest={id} />
            {id === "collector" && <small>+ {t(`appearance.frame.${REWARD_FRAME}`)}</small>}
          </span>
        </li>;
      })}
    </ol>
  </section>;
}
