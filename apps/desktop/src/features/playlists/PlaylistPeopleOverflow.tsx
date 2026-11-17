import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlaylistContributor } from "@luft/protocol-types";
import type { SocialProfile } from "../friends/friendsTypes";
import { t } from "../../i18n";
import { PlaylistPerson, type PlaylistPersonEntry } from "./PlaylistPeople";

/** Hover has a small grace period for crossing from the trigger into the portal. */
export function PlaylistPeopleOverflow({ people, profileFor, complete }: {
  people: PlaylistPersonEntry[];
  profileFor: (person: PlaylistContributor) => SocialProfile | undefined;
  complete: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 0 });
  const cancel = () => clearTimeout(timer.current);
  const show = () => { cancel(); setOpen(true); };
  const leave = () => {
    cancel();
    timer.current = setTimeout(() => {
      if (!trigger.current?.contains(document.activeElement) && !panel.current?.contains(document.activeElement)) setOpen(false);
    }, 180);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const height = Math.min(panel.current?.scrollHeight ?? 300, window.innerHeight - 32);
      const below = window.innerHeight - anchor.bottom - 24;
      const top = below >= Math.min(height, 180) ? anchor.bottom + 8 : Math.max(16, anchor.top - height - 8);
      const width = panel.current?.offsetWidth ?? 280;
      setPosition({ left: Math.max(16, Math.min(anchor.left, window.innerWidth - width - 16)), top, maxHeight: window.innerHeight - top - 16 });
    };
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); cancel(); trigger.current?.focus(); setOpen(false); }
    };
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) place(); };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, people.length]);
  return <>
    <button ref={trigger} className="playlist-people-more" type="button" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-label={t("playlists.morePeople", { n: people.length })}
      onPointerEnter={show} onPointerLeave={leave} onFocus={show} onBlur={leave}
      onClick={show} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); show(); requestAnimationFrame(() => panel.current?.focus()); } }}>
      +{people.length}
    </button>
    {open && createPortal(<div ref={panel} id={id} className="playlist-people-popover" role="region" aria-label={t("playlists.people")} tabIndex={0}
      style={position} onPointerEnter={show} onPointerLeave={leave} onFocus={cancel} onBlur={leave}>
      <strong>{t("playlists.people")}</strong>
      {people.map(({ person, owner, count }) => <div className="playlist-person-detail" key={person.username}>
        <PlaylistPerson profile={profileFor(person)} />
        <small>{owner ? `${t("playlists.owner")} · ` : ""}{t(count === 1 ? "playlists.contributionOne" : "playlists.contributionMany", { n: count })}</small>
      </div>)}
      {!complete && <small>{t("playlists.peoplePartial")}</small>}
      {people.some(({ person }) => !profileFor(person)) && <small>{t("playlists.identityHint")}</small>}
    </div>, document.body)}
  </>;
}
