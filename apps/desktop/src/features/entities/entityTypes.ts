import type { EntitySummary } from "@luft/protocol-types";

export type EntityKind = "Künstler" | "Album" | "Playlist";

export interface EntityViewProps {
  uri: string;
  summary: EntitySummary | undefined;
}
