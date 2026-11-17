import { useQuery } from "@tanstack/react-query";
import {
  Coffee, Crown, Flame, Flower2, Gamepad2, Gem, Ghost, Headphones, Heart, Moon, Music2, Rocket, Sparkles, Star, Sun, Zap,
  type LucideIcon,
} from "lucide-react";
import { friendsApi } from "./friendsApi";
import type { BadgeDefinition } from "./friendsTypes";
import { FRIENDS_QUERY_KEY } from "./useFriends";

/** Mirrors BADGE_ICONS and BADGE_COLORS in luft-listen-together. */
export type BadgeIcon = "star" | "heart" | "music" | "headphones" | "crown" | "flame" | "zap" | "moon" | "sun" | "sparkles" | "gamepad" | "coffee" | "gem" | "rocket" | "flower" | "ghost";
export const BADGE_ICONS: Record<BadgeIcon, LucideIcon> = {
  star: Star, heart: Heart, music: Music2, headphones: Headphones, crown: Crown, flame: Flame, zap: Zap, moon: Moon,
  sun: Sun, sparkles: Sparkles, gamepad: Gamepad2, coffee: Coffee, gem: Gem, rocket: Rocket, flower: Flower2, ghost: Ghost,
};
export const badgeIcon = (key: string): LucideIcon | undefined => BADGE_ICONS[key as BadgeIcon];
export const BADGE_COLORS = ["sky", "violet", "rose", "amber", "mint", "coral", "gold", "slate"] as const;
export const MAX_BADGE_LABEL = 20;
export const MAX_BIO_LENGTH = 80;

const NO_BADGES: BadgeDefinition[] = [];

/**
 * The server's badge catalog from the friends status that FriendsSync keeps
 * fresh. Reads the cache only; it never starts a request of its own.
 */
export function useBadgeCatalog(): BadgeDefinition[] {
  return useQuery({
    queryKey: FRIENDS_QUERY_KEY,
    queryFn: friendsApi.status,
    enabled: false,
    select: (status) => status.snapshot?.badges ?? NO_BADGES,
  }).data ?? NO_BADGES;
}
