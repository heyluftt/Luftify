use luft_listen_together::{ProfileStyle, media::{MEDIA_UPLOADS_PER_DAY, MediaKind}};

use super::*;

const GIF: &[u8] = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;";
const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10];

fn look(avatar: Option<&str>, banner: Option<&str>) -> ProfileStyle {
    ProfileStyle {
        accent: "rose".into(), banner: "ocean".into(), color: Some("#ff8800".into()),
        avatar_media: avatar.map(Into::into), banner_media: banner.map(Into::into), ..Default::default()
    }
}

#[tokio::test]
async fn media_belongs_to_its_owner_and_kind() {
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let two = user(&store, "Two").await;
    let (one_id, two_id) = (&one.snapshot.me.id, &two.snapshot.me.id);

    let moving = store.upload_media(one_id, MediaKind::Avatar, GIF).await.unwrap().id;
    let banner = store.upload_media(one_id, MediaKind::Banner, JPEG).await.unwrap().id;
    assert!(moving.ends_with(".gif") && banner.ends_with(".jpg"));
    // A still picture is no moving one, and unknown bytes are refused.
    assert_eq!(store.upload_media(one_id, MediaKind::Avatar, JPEG).await.unwrap_err().code, "invalidMedia");
    assert_eq!(store.upload_media(one_id, MediaKind::Banner, b"<svg/>").await.unwrap_err().code, "invalidMedia");
    let large = [GIF, &vec![0; MediaKind::Avatar.max_bytes()]].concat();
    assert_eq!(store.upload_media(one_id, MediaKind::Avatar, &large).await.unwrap_err().code, "mediaTooLarge");

    store.action(one_id, SocialAction::SetStyle { style: Some(look(Some(&moving), Some(&banner))) }).await.unwrap();
    assert_eq!(store.media(&moving).await.unwrap(), (GIF.to_vec(), "image/gif"));
    // Someone else's file, or a banner used as picture, is refused.
    assert_eq!(store.action(two_id, SocialAction::SetStyle { style: Some(look(Some(&moving), None)) }).await.unwrap_err().code, "invalidMedia");
    let stray = store.upload_media(one_id, MediaKind::Banner, GIF).await.unwrap().id;
    assert_eq!(store.action(one_id, SocialAction::SetStyle { style: Some(look(Some(&stray), None)) }).await.unwrap_err().code, "invalidMedia");
    assert_eq!(store.media("../social.sqlite").await.unwrap_err().code, "notFound");
}

#[tokio::test]
async fn unused_media_is_removed_and_uploads_are_bounded() {
    let store = Store::memory().await;
    let one = user(&store, "One").await;
    let id = &one.snapshot.me.id;
    let used = store.upload_media(id, MediaKind::Banner, JPEG).await.unwrap().id;
    let unused = store.upload_media(id, MediaKind::Banner, GIF).await.unwrap().id;
    store.action(id, SocialAction::SetStyle { style: Some(look(None, Some(&used))) }).await.unwrap();

    // Fresh uploads stay, so an open editor can still save them.
    store.forget_unused_media().await.unwrap();
    assert!(store.media(&unused).await.is_ok());
    sqlx::query("UPDATE media SET created_at = 0").execute(&store.pool).await.unwrap();
    store.forget_unused_media().await.unwrap();
    assert!(store.media(&used).await.is_ok());
    assert_eq!(store.media(&unused).await.unwrap_err().code, "notFound");

    for _ in 2..MEDIA_UPLOADS_PER_DAY {
        store.upload_media(id, MediaKind::Banner, JPEG).await.unwrap();
    }
    assert_eq!(store.upload_media(id, MediaKind::Banner, JPEG).await.unwrap_err().code, "limitReached");
}
