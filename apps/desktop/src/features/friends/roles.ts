import { Code2, FlaskConical, Heart, Star, Wind, type LucideIcon } from "lucide-react";
import type { MessageKey } from "../../i18n";
import type { SocialProfile, SocialRole } from "./friendsTypes";

interface RoleInfo { icon: LucideIcon; label: MessageKey; hint: MessageKey }

/** In rank order: the first role a profile holds is its main badge. */
export const ROLES: Record<SocialRole, RoleInfo> = {
  luft: { icon: Wind, label: "roles.luft", hint: "roles.luftHint" },
  dev: { icon: Code2, label: "roles.dev", hint: "roles.devHint" },
  heart: { icon: Heart, label: "roles.heart", hint: "roles.heartHint" },
  crew: { icon: Star, label: "roles.crew", hint: "roles.crewHint" },
  tester: { icon: FlaskConical, label: "roles.tester", hint: "roles.testerHint" },
};

const RANK = Object.keys(ROLES) as SocialRole[];

/** Luft cannot be given away; it comes from the server configuration. */
export const GRANTABLE_ROLES: SocialRole[] = ["dev", "heart", "crew", "tester"];

export function knownRoles(roles: readonly string[] | undefined): SocialRole[] {
  return RANK.filter((role) => roles?.includes(role));
}

export function mainRole(roles: readonly string[] | undefined): SocialRole | undefined {
  return knownRoles(roles)[0];
}

export const managesRoles = (profile: SocialProfile | undefined) => Boolean(profile?.roles?.includes("luft"));

/** Generated codes are ten hex digits; anything else was chosen by Luft. */
export const isCustomCode = (code: string) => !/^LF-[0-9A-F]{10}$/.test(code);
