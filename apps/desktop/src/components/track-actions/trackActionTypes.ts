import type { EntitySummary } from "@luft/protocol-types";

export type RunTrackAction = (key: string, action: () => void | Promise<void>, success: string) => Promise<void>;

export type TrackMenuNavigate = (path: string, summary?: EntitySummary) => void;
