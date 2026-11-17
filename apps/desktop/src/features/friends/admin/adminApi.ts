import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { appLanguage } from "../../../i18n";
import type { ServerSettings, SocialProfile } from "../friendsTypes";

export interface AdminUser {
  profile: SocialProfile;
  online: boolean;
  listening: boolean;
  lastSeenMs?: number | null;
  /** PC app, running now or last seen. */
  appVersion?: string | null;
  /** Phone app, running now or last seen. */
  phoneVersion?: string | null;
  friends: number;
  mediaBytes: number;
  suspended: boolean;
}
export interface ServerState {
  startedAtMs: number;
  version: string;
  databaseBytes: number;
  /** Daily copies on the server; older servers send nothing. */
  backups?: number;
  lastBackupMs?: number | null;
  settings: ServerSettings;
  roomMembers: number;
  reports: number;
}
export interface AdminLogEntry { atMs: number; actor: string; target?: string | null; action: string; detail?: string | null }
export interface AdminOverview {
  users: AdminUser[];
  mediaBytes: number;
  mediaLimitBytes: number;
  rooms: number;
  /** Missing from servers before protocol 16. */
  server?: ServerState;
  log?: AdminLogEntry[];
}

/** Saves the server database under Documents\Luftify\Backups; resolves with the path. */
export const adminBackup = () => invoke<string>("friends_admin_backup");

export const ADMIN_QUERY_KEY = ["friends-admin"] as const;

/** Luft's user overview, fresh every 30 s while the Luft corner is open. */
export function useAdminOverview(enabled: boolean) {
  return useQuery({
    queryKey: ADMIN_QUERY_KEY,
    queryFn: () => invoke<AdminOverview>("friends_admin_overview"),
    enabled,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: false,
  });
}

/** "0.1.12" > "0.1.9", part by part. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/** The newest version anyone runs counts as current. */
export function newestVersion(users: AdminUser[]): string | null {
  return users.map((user) => user.appVersion).filter((version): version is string => Boolean(version))
    .reduce<string | null>((newest, version) => !newest || compareVersions(version, newest) > 0 ? version : newest, null);
}

/** "5,4" in German, "5.4" in English. */
export const megabytes = (bytes: number) => (Math.round((bytes / (1024 * 1024)) * 10) / 10).toLocaleString(appLanguage() === "en" ? "en-GB" : "de-DE");
