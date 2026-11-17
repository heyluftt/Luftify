import { SmilePlus, X, UserRound, Palette, Award, Music2, Eye } from "lucide-react";
import { useState } from "react";
import { t } from "../../../i18n";
import type { SharedTrack } from "../../listen-together/listenTogetherTypes";
import { DEFAULT_STYLE, PROFILE_EMOJIS } from "../appearance";
import { MAX_BIO_LENGTH } from "../customBadges";
import type { FriendsControls, FriendsOperation, ProfileStyle, SocialProfile } from "../friendsTypes";
import { accentColor as accentStyle } from "../appearance";
import { BadgeInventory } from "./BadgeInventory";
import { PictureField } from "./PictureField";
import { ProfilePreview, type PreviewMode } from "./ProfilePreview";
import { ProfileLookEditor } from "./ProfileLookEditor";
import { ProfileSongPicker } from "./ProfileSongPicker";

type Section = "profile" | "look" | "badges" | "song";

const OPTIONAL = ["frame", "effect", "emoji", "color", "nameColor", "nameFrom", "avatarMedia", "bannerMedia", "shownBadges"] as const;

/** Field by field, so the order the server sends them in does not matter. */
const sameStyle = (a: ProfileStyle | null | undefined, b: ProfileStyle | null | undefined) => {
  if (!a || !b) return !a && !b;
  return a.accent === b.accent && a.banner === b.banner && Boolean(a.nameGradient) === Boolean(b.nameGradient)
    && Boolean(a.showTrophies) === Boolean(b.showTrophies)
    // JSON for the badge list; the other fields are strings.
    && OPTIONAL.every((key) => JSON.stringify(a[key] || null) === JSON.stringify(b[key] || null));
};

/** Only what differs from the defaults is kept, so "nothing chosen" stays `null`. */
function tidy(style: ProfileStyle | null): ProfileStyle | null {
  if (!style) return null;
  const tidied: ProfileStyle = {
    accent: style.accent, banner: style.banner,
    ...(style.nameGradient ? { nameGradient: true } : {}), ...(style.showTrophies ? { showTrophies: true } : {}),
  };
  for (const key of OPTIONAL) {
    const value = style[key];
    if (value) Object.assign(tidied, { [key]: value });
  }
  // The gradient colours only matter with the gradient on.
  if (!tidied.nameGradient) { delete tidied.nameColor; delete tidied.nameFrom; }
  return tidied;
}

/**
 * Edit picture, name, status, look and profile song with a live preview of
 * how friends see the profile and the card. Name and picture also update the
 * listening-room profile (the app saves them locally as well).
 */
export function OwnProfileEditor({ me, controls, offline, onDone }: { me: SocialProfile; controls: FriendsControls; offline: boolean; onDone: () => void }) {
  const [section, setSection] = useState<Section>("profile");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("profile");
  const [name, setName] = useState(me.displayName);
  const [avatar, setAvatar] = useState<string | null>(me.avatarUri ?? null);
  const [bio, setBio] = useState(me.bio ?? "");
  const [style, setStyle] = useState<ProfileStyle | null>(me.style ?? null);
  // Keep the uploaded sample available while trying presets or switching tabs.
  const [ownBanner, setOwnBanner] = useState<string | null>(me.style?.bannerMedia ?? null);
  const [favorite, setFavorite] = useState<SharedTrack | null>(me.favorite ?? null);
  const [uploading, setUploading] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const onBusy = (busy: boolean) => setUploading((count) => Math.max(0, count + (busy ? 1 : -1)));

  const nextBio = bio.trim() || null;
  const nextStyle = tidy(style);
  const operations: FriendsOperation[] = [
    ...(name.trim() !== me.displayName || avatar !== (me.avatarUri ?? null)
      ? [{ type: "action", action: { type: "updateProfile", profile: { displayName: name.trim(), avatarUri: avatar } } } as const] : []),
    ...(nextBio !== (me.bio ?? null) ? [{ type: "action", action: { type: "setBio", bio: nextBio } } as const] : []),
    ...(!sameStyle(nextStyle, me.style) ? [{ type: "action", action: { type: "setStyle", style: nextStyle } } as const] : []),
    ...((favorite?.uri ?? null) !== (me.favorite?.uri ?? null) ? [{ type: "action", action: { type: "setFavorite", track: favorite } } as const] : []),
  ];
  const busy = controls.pending || offline || uploading > 0;
  // One change after the other; the dialog returns to the profile after the last.
  const run = (index: number) => {
    const operation = operations[index];
    if (!operation) return onDone();
    setSaveError(undefined);
    controls.send(operation, (status) => {
      // An older server drops what it does not know (own colour, media) without an error.
      if (operation.type === "action" && operation.action.type === "setStyle" && !sameStyle(tidy(status.snapshot?.me.style ?? null), nextStyle)) {
        return setSaveError(t("friends.error.serverUpdateRequired"));
      }
      run(index + 1);
    });
  };
  const current = style ?? DEFAULT_STYLE;
  // Any look choice starts from the defaults; clearing something on a profile
  // without a look keeps it without one.
  const patch = (change: Partial<ProfileStyle>) => setStyle((previous) =>
    !previous && Object.values(change).every((value) => !value) ? previous : { ...(previous ?? DEFAULT_STYLE), ...change });
  const preview: SocialProfile = { ...me, displayName: name.trim() || me.displayName, avatarUri: avatar, bio: nextBio, style: nextStyle, favorite };
  const look = nextStyle ?? undefined;
  // Fields stay usable while a file uploads; only saving waits for it.
  const locked = controls.pending || offline;

  const sections: { key: Section; label: string; icon: typeof UserRound }[] = [
    { key: "profile", icon: UserRound, label: t("appearance.profile") },
    { key: "look", icon: Palette, label: t("appearance.look") },
    { key: "badges", icon: Award, label: t("badgeInventory.tab") },
    { key: "song", icon: Music2, label: t("appearance.song") },
  ];

  return <form className="own-profile-editor" data-accent={current.accent} style={accentStyle(current.color)} onSubmit={(event) => {
    event.preventDefault();
    if (!busy && name.trim()) run(0);
  }}>
    <header className="own-profile-editor-heading"><span>{t("profileLook.studio")}</span><h2 id="friend-profile-name">{t("ownProfile.editTitle")}</h2></header>
    <div className="own-profile-editor-grid">
      <aside className="own-profile-preview" aria-label={t("appearance.preview")}>
        <small className="own-profile-preview-label"><Eye size={13} aria-hidden="true" />{t("profileLook.livePreview")}</small>
        <div className="own-profile-preview-switch" role="tablist" aria-label={t("appearance.preview")}>
          {(["profile", "card"] as const).map((mode) => <button key={mode} type="button" role="tab" aria-selected={previewMode === mode}
            onClick={() => setPreviewMode(mode)}>{t(mode === "profile" ? "appearance.previewProfile" : "appearance.previewCard")}</button>)}
        </div>
        <ProfilePreview profile={preview} mode={previewMode} />
      </aside>

      <div className="own-profile-fields">
        <div className="own-profile-sections" role="tablist" aria-label={t("ownProfile.editTitle")}>
          {sections.map((entry) => <button key={entry.key} type="button" role="tab" aria-selected={section === entry.key}
            onClick={() => setSection(entry.key)}><entry.icon size={15} aria-hidden="true" />{entry.label}</button>)}
        </div>

        {section === "profile" && <>
          <PictureField name={name} picture={{ avatar, motion: style?.avatarMedia ?? null }} roles={me.roles} frame={look?.frame}
            accent={look?.accent} color={look?.color ?? undefined} disabled={locked} onBusy={onBusy}
            onChange={(picture) => { setAvatar(picture.avatar); patch({ avatarMedia: picture.motion }); }} />
          <fieldset>
            <legend><label htmlFor="own-profile-name">{t("listen.profileName")}</label></legend>
            <input id="own-profile-name" value={name} maxLength={32} autoComplete="nickname" disabled={busy} required
              onChange={(event) => setName(event.currentTarget.value)} />
          </fieldset>
          <fieldset>
            <legend><label htmlFor="own-profile-bio">{t("friendProfile.bio")}</label></legend>
            <div className="own-profile-bio-row">
              <button type="button" className="own-profile-bio-emoji" aria-expanded={emojiOpen} aria-controls="own-profile-emojis" disabled={busy}
                title={t("appearance.emoji")} aria-label={t("appearance.emoji")} onClick={() => setEmojiOpen(!emojiOpen)}>
                {current.emoji ?? <SmilePlus size={18} aria-hidden="true" />}
              </button>
              <input id="own-profile-bio" value={bio} maxLength={MAX_BIO_LENGTH} placeholder={t("friendProfile.bioPlaceholder")} disabled={busy}
                onChange={(event) => setBio(event.currentTarget.value)} />
            </div>
            <small>{t("friendProfile.bioHint", { n: MAX_BIO_LENGTH - bio.length })}</small>
            {emojiOpen && <div id="own-profile-emojis" className="own-profile-emojis" role="radiogroup" aria-label={t("appearance.emoji")}>
              <button type="button" role="radio" aria-checked={!style?.emoji} disabled={busy} onClick={() => { patch({ emoji: null }); setEmojiOpen(false); }}
                title={t("appearance.emojiNone")} aria-label={t("appearance.emojiNone")}><X size={15} aria-hidden="true" /></button>
              {PROFILE_EMOJIS.map((emoji) => <button key={emoji} type="button" role="radio" aria-checked={style?.emoji === emoji} disabled={busy}
                aria-label={emoji} onClick={() => { patch({ emoji }); setEmojiOpen(false); }}>{emoji}</button>)}
            </div>}
          </fieldset>
        </>}

        {section === "look" && <ProfileLookEditor profile={preview} style={current} disabled={busy} uploadingDisabled={locked}
          ownBanner={ownBanner} onOwnBanner={setOwnBanner} onBusy={onBusy} onPick={patch} onChooseSong={() => setSection("song")} />}
        {section === "badges" && <>
          <label className="own-profile-toggle">
            <strong>{t("profileLook.showTrophies")}</strong>
            <span className="switch"><input type="checkbox" checked={Boolean(style?.showTrophies)} disabled={busy}
              onChange={(event) => patch({ showTrophies: event.currentTarget.checked })} /><span /></span>
          </label>
          <BadgeInventory profile={me} shown={style?.shownBadges ?? null} disabled={busy}
            onChange={(shownBadges) => patch({ shownBadges })} />
        </>}

        {section === "song" && <fieldset>
          <legend>{t("appearance.song")}</legend>
          <ProfileSongPicker value={favorite} disabled={busy} onChange={(track) => {
            setFavorite(track);
            // Without a song the cover background has nothing to show.
            if (!track && style?.banner === "cover") patch({ banner: DEFAULT_STYLE.banner });
          }} />
        </fieldset>}
      </div>
    </div>
    <div className="own-profile-editor-actions">
      {saveError ? <small className="friends-inline-error" role="alert">{saveError}</small> : <small>{operations.length ? t("appearance.unsaved") : ""}</small>}
      <button type="button" className="secondary-button" disabled={controls.pending} onClick={onDone}>{t("friends.cancel")}</button>
      <button type="submit" className="primary-button" disabled={busy || !name.trim() || !operations.length}>
        {t(controls.pending ? "friends.working" : "listen.save")}
      </button>
    </div>
  </form>;
}
