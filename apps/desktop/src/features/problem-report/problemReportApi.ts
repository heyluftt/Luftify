import { invoke } from "@tauri-apps/api/core";
import type { SocialSnapshot } from "../friends/friendsTypes";

export interface ProblemReportSummary {
  id: string;
  reporterId: string;
  reporterName: string;
  message: string;
  appVersion: string;
  createdAtMs: number;
  hasDiagnostics: boolean;
}

export interface ProblemReport extends ProblemReportSummary { diagnostics: string }

export const MAX_REPORT_MESSAGE = 1000;
export const REPORTS_QUERY_KEY = ["problem-reports"] as const;

export const problemReportApi = {
  preview: () => invoke<string>("problem_report_preview"),
  send: (message: string, includeDetails: boolean) => invoke<ProblemReportSummary>("problem_report_send", { message, includeDetails }),
  list: () => invoke<ProblemReportSummary[]>("problem_reports_list"),
  get: (id: string) => invoke<ProblemReport>("problem_report_get", { id }),
  remove: (id: string) => invoke<void>("problem_report_delete", { id }),
  previousSession: () => invoke<PreviousSession | null>("previous_session"),
  dismissPreviousSession: () => invoke<void>("dismiss_previous_session"),
};

/** The last session ended without a clean exit (session_guard in Rust). */
export interface PreviousSession {
  version: string;
  startedAtMs: number;
  endedAtMs: number;
  cause: "hang" | "panic" | "unknown";
  hangMs?: number;
}

/** The server only takes reports from Luft and Luft's friends. */
export function canReport(snapshot: SocialSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  return Boolean(snapshot.me.roles?.includes("luft") || snapshot.friends.some((friend) => friend.profile.roles?.includes("luft")));
}

export function reportErrorKey(error: unknown): string {
  const raw = typeof error === "string" ? error
    : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "";
  return raw === "friends.error.limitReached" ? "report.error.limit" : raw;
}
