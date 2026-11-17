import { Fragment } from "react";
import { openExternalUrl } from "../entities/spotifyLinks";
import { parseSpotifyLink } from "../links/spotifyLink";
import { ChatLinkCard } from "./ChatLinkCard";

const URL = /(https?:\/\/[^\s<>"]+[^\s<>".,!?;:)\]])/g;

/** Message text with clickable links; a Spotify link also shows as a card, and a bare one only as the card. */
export function ChatMessageBody({ body }: { body: string }) {
  const link = parseSpotifyLink(body);
  const bare = link && body.trim().split(/\s+/).length === 1;
  return <>
    {!bare && <p>{body.split(URL).map((part, index) => index % 2
      ? <a key={index} href={part} onClick={(event) => { event.preventDefault(); openExternalUrl(part); }}>{part}</a>
      : <Fragment key={index}>{part}</Fragment>)}</p>}
    {link && <ChatLinkCard link={link} />}
  </>;
}
