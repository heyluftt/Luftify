import type { Activity } from "./friendsTypes";

/** A coloured dot with its label: online, away, busy or offline/last seen. */
export function ActivityLine({ activity, text, listening = false }: { activity: Activity; text: string; listening?: boolean }) {
  return <span className="activity-line" data-activity={activity} data-listening={listening || undefined}><i aria-hidden="true" />{text}</span>;
}
