import { AudioLines, Headphones, Music2, Palette, Radio, Trophy, UserPlus, Users, type LucideIcon } from "lucide-react";
import type { MessageKey } from "../../../i18n";

/** Mirrors ACHIEVEMENTS in luft-listen-together, in display order. */
export const ACHIEVEMENTS = ["first_friend", "circle", "styled", "song", "together", "along", "host", "collector"] as const;
export type AchievementId = (typeof ACHIEVEMENTS)[number];
/** The frame only the collector may wear (REWARD_FRAME). */
export const REWARD_FRAME = "aurum";

interface AchievementInfo { icon: LucideIcon; color: string }

/** Icon and badge colour; colours are the badge palette keys from roles.css. */
export const ACHIEVEMENT_INFO: Record<AchievementId, AchievementInfo> = {
  first_friend: { icon: UserPlus, color: "mint" },
  circle: { icon: Users, color: "sky" },
  styled: { icon: Palette, color: "violet" },
  song: { icon: Music2, color: "rose" },
  together: { icon: Headphones, color: "amber" },
  along: { icon: AudioLines, color: "coral" },
  host: { icon: Radio, color: "slate" },
  collector: { icon: Trophy, color: "gold" },
};

export const isAchievement = (id: string): id is AchievementId => (ACHIEVEMENTS as readonly string[]).includes(id);
export const achievementName = (id: AchievementId) => `achievement.${id}` as MessageKey;
export const achievementHint = (id: AchievementId) => `achievement.${id}.hint` as MessageKey;
