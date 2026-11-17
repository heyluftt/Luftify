use std::time::{Duration, Instant};

use http::Method;
use librespot::core::Session;
use luft_core::{EntitySummary, Page, PageRequest, PlaylistLibraryInfo, PlaylistOwner};
use serde_json::Value;
use tracing::{info, warn};

use super::{
    collect_entities, hydrate_missing_playlist_covers, image_url, page_from_items, string_value,
    unique_by_uri,
};

const ROOTLIST_REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

pub(super) async fn rootlist_playlists(
    session: &Session,
    request: PageRequest,
) -> Option<Page<EntitySummary>> {
    let started = Instant::now();
    let request = PageRequest {
        offset: request.offset,
        limit: request.limit.clamp(1, 50),
    };
    let user = session.username();
    let endpoint = format!(
        "/playlist/v2/user/{user}/rootlist?decorate=revision,attributes,length,owner,capabilities,status_code&from={}&length={}",
        request.offset, request.limit
    );
    let bytes = match tokio::time::timeout(
        ROOTLIST_REQUEST_TIMEOUT,
        session
            .spclient()
            .request_as_json(&Method::GET, &endpoint, None, None),
    )
    .await
    {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(error)) => {
            warn!(
                adapter = "librespot",
                phase = "library-rootlist",
                error = %error,
                elapsed_ms = started.elapsed().as_millis(),
                "librespot rootlist request failed"
            );
            return None;
        }
        Err(_) => {
            warn!(
                adapter = "librespot",
                phase = "library-rootlist",
                timeout_ms = ROOTLIST_REQUEST_TIMEOUT.as_millis(),
                "librespot rootlist request timed out"
            );
            return None;
        }
    };
    let value = match serde_json::from_slice::<Value>(&bytes) {
        Ok(value) => value,
        Err(error) => {
            warn!(
                adapter = "librespot",
                phase = "library-rootlist",
                error = %error,
                bytes = bytes.len(),
                elapsed_ms = started.elapsed().as_millis(),
                "librespot rootlist response was not valid JSON"
            );
            return None;
        }
    };
    let open_folders = if request.offset > 0 {
        folders_open_at(session, &user, request.offset).await
    } else {
        Vec::new()
    };
    let ParsedRootlistPage {
        mut page,
        candidate_count,
        unresolved,
        structure,
    } = parse_rootlist_page(&user, request, &value, &open_folders);
    info!(
        adapter = "librespot",
        phase = "library-rootlist",
        candidates = candidate_count,
        playlists = page.items.len(),
        unresolved,
        total = ?page.total,
        top_level_length = ?structure.top_level_length,
        contents_items = structure.items,
        contents_meta_items = structure.meta_items,
        contents_pos = ?structure.pos,
        contents_truncated = ?structure.truncated,
        first_item_keys = structure.first_item_keys.as_str(),
        first_meta_item_keys = structure.first_meta_item_keys.as_str(),
        bytes = bytes.len(),
        elapsed_ms = started.elapsed().as_millis(),
        "librespot rootlist response parsed"
    );
    if structure.items > 0 && unresolved > 0 {
        warn!(
            adapter = "librespot",
            phase = "library-rootlist",
            candidates = candidate_count,
            playlists = page.items.len(),
            unresolved,
            "librespot rootlist page contained unresolved entries; returning resolved playlists"
        );
    }
    if page.items.is_empty() {
        info!(
            adapter = "librespot",
            phase = "library-rootlist",
            "librespot rootlist contained no playlists"
        );
        return Some(page);
    }
    hydrate_missing_playlist_covers(session, &mut page.items).await;
    Some(page)
}

/// Folders a page starts inside of. The rootlist is a flat list with
/// start/end markers, so a later page cannot see which folder it continues;
/// the undecorated prefix (URIs only) is small enough to replay.
async fn folders_open_at(session: &Session, user: &str, offset: u32) -> Vec<String> {
    let endpoint = format!("/playlist/v2/user/{user}/rootlist?from=0&length={offset}");
    let Ok(Ok(bytes)) = tokio::time::timeout(
        ROOTLIST_REQUEST_TIMEOUT,
        session
            .spclient()
            .request_as_json(&Method::GET, &endpoint, None, None),
    )
    .await
    else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
        return Vec::new();
    };
    let mut folders = Vec::new();
    for item in rootlist_content_items(&value).unwrap_or(&[]) {
        if let Some(uri) = string_value(item.get("uri")) {
            track_folder(&mut folders, &uri);
        }
    }
    folders
}

/// Applies a `spotify:start-group:<id>:<name>` / `spotify:end-group:<id>`
/// marker to the open folders; returns whether `uri` was one.
fn track_folder(folders: &mut Vec<String>, uri: &str) -> bool {
    if let Some(rest) = uri.strip_prefix("spotify:start-group:") {
        let name = rest.split_once(':').map_or("", |(_, name)| name);
        folders.push(decode_group_name(name));
        return true;
    }
    if uri.starts_with("spotify:end-group:") {
        folders.pop();
        return true;
    }
    false
}

/// Group names are form-encoded: `+` for spaces, `%XX` for bytes.
fn decode_group_name(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        let escaped = (byte == b'%')
            .then(|| raw.get(index + 1..index + 3))
            .flatten()
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match (byte, escaped) {
            (_, Some(value)) => {
                decoded.push(value);
                index += 3;
            }
            (b'+', None) => {
                decoded.push(b' ');
                index += 1;
            }
            (other, None) => {
                decoded.push(other);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&decoded).trim().to_owned()
}

fn playlist_owner(owner: Option<String>, username: &str) -> Option<PlaylistOwner> {
    let owner = owner?;
    Some(if !username.is_empty() && owner == username {
        PlaylistOwner::Me
    } else if owner == "spotify" {
        PlaylistOwner::Spotify
    } else {
        PlaylistOwner::Other
    })
}

fn library_info(
    item: &Value,
    metadata: Option<&Value>,
    username: &str,
    folders: &[String],
) -> PlaylistLibraryInfo {
    PlaylistLibraryInfo {
        track_count: metadata
            .and_then(|meta| meta.get("length"))
            .and_then(value_u32),
        owner: playlist_owner(
            metadata.and_then(|meta| string_value(meta.get("ownerUsername"))),
            username,
        ),
        added_at: item
            .pointer("/attributes/timestamp")
            .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
            .filter(|at| *at > 0),
        folder: (!folders.is_empty()).then(|| folders.join(" / ")),
        collaborative: metadata
            .and_then(|meta| meta.pointer("/attributes/collaborative"))
            .and_then(Value::as_bool)
            .filter(|collaborative| *collaborative),
    }
}

#[cfg(test)]
fn collect_rootlist_playlists(value: &Value, username: &str) -> Vec<EntitySummary> {
    collect_rootlist_playlists_in(value, username, &[])
}

fn collect_rootlist_playlists_in(
    value: &Value,
    username: &str,
    open_folders: &[String],
) -> Vec<EntitySummary> {
    if let Some(items) = rootlist_content_items(value) {
        let meta_items = rootlist_content_meta_items(value).unwrap_or(&[]);
        let mut folders = open_folders.to_vec();
        let entities = items
            .iter()
            .enumerate()
            .filter_map(|(index, item)| {
                if string_value(item.get("uri")).is_some_and(|uri| track_folder(&mut folders, &uri))
                {
                    return None;
                }
                let uri = rootlist_item_playlist_uri(item)?;
                let metadata = meta_items.get(index);
                let name = metadata
                    .and_then(|value| rootlist_name(value, 5))
                    .or_else(|| rootlist_name(item, 5))?;
                let cover_uri = metadata
                    .and_then(|value| rootlist_cover(value, 5))
                    .or_else(|| rootlist_cover(item, 5));
                Some(EntitySummary {
                    uri,
                    name,
                    subtitle: Some("Playlist".into()),
                    cover_uri,
                    can_modify: metadata
                        .and_then(|meta| super::permissions::playlist_write_access(meta, username))
                        .or_else(|| super::permissions::playlist_write_access(item, username)),
                    library: Some(library_info(item, metadata, username, &folders)),
                })
            })
            .collect();
        return unique_by_uri(entities);
    }

    let mut entities = collect_entities(value)
        .into_iter()
        .filter(|item| item.uri.contains(":playlist:"))
        .collect::<Vec<_>>();
    // Cosmos rootlists also occur in a split shape where the playlist URI is
    // stored in rowId/link while its name lives in a nested metadata object.
    // The generic entity reader intentionally requires both on one record, so
    // recover those entries at this adapter boundary without leaking the raw
    // private response shape into the rest of the player.
    walk_rootlist_playlists(value, &mut entities, 0, username);
    unique_by_uri(entities)
}

fn rootlist_content_items(value: &Value) -> Option<&[Value]> {
    value
        .pointer("/contents/items")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
}

fn rootlist_content_meta_items(value: &Value) -> Option<&[Value]> {
    value
        .pointer("/contents/metaItems")
        .or_else(|| value.pointer("/contents/meta_items"))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
}

fn rootlist_item_playlist_uri(value: &Value) -> Option<String> {
    string_value(value.get("uri"))
        .or_else(|| string_value(value.pointer("/item/uri")))
        .and_then(|uri| normalize_rootlist_playlist_uri(&uri))
}

fn rootlist_playlist_candidate_count(value: &Value) -> Option<usize> {
    rootlist_content_items(value).map(|items| {
        items
            .iter()
            .filter(|item| rootlist_item_playlist_uri(item).is_some())
            .count()
    })
}

#[derive(Default)]
struct RootlistStructure {
    top_level_length: Option<u32>,
    items: usize,
    meta_items: usize,
    pos: Option<u32>,
    truncated: Option<bool>,
    first_item_keys: String,
    first_meta_item_keys: String,
}

struct ParsedRootlistPage {
    page: Page<EntitySummary>,
    candidate_count: usize,
    unresolved: usize,
    structure: RootlistStructure,
}

fn parse_rootlist_page(
    username: &str,
    request: PageRequest,
    value: &Value,
    open_folders: &[String],
) -> ParsedRootlistPage {
    let structure = rootlist_structure(value);
    let items = collect_rootlist_playlists_in(value, username, open_folders);
    let candidate_count = rootlist_playlist_candidate_count(value).unwrap_or(items.len());
    let unresolved = candidate_count.saturating_sub(items.len());
    let page = page_from_rootlist(request, items, rootlist_total(value), &structure);
    ParsedRootlistPage {
        page,
        candidate_count,
        unresolved,
        structure,
    }
}

fn rootlist_structure(value: &Value) -> RootlistStructure {
    let items = rootlist_content_items(value).unwrap_or(&[]);
    let meta_items = rootlist_content_meta_items(value).unwrap_or(&[]);
    RootlistStructure {
        top_level_length: value.get("length").and_then(value_u32),
        items: items.len(),
        meta_items: meta_items.len(),
        pos: value.pointer("/contents/pos").and_then(value_u32),
        truncated: value
            .pointer("/contents/truncated")
            .and_then(Value::as_bool),
        first_item_keys: value_keys(items.first()),
        first_meta_item_keys: value_keys(meta_items.first()),
    }
}

fn value_keys(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return "none".into();
    };
    let Some(object) = value.as_object() else {
        return match value {
            Value::Array(_) => "array",
            Value::Bool(_) => "boolean",
            Value::Number(_) => "number",
            Value::String(_) => "string",
            Value::Null => "null",
            Value::Object(_) => unreachable!(),
        }
        .into();
    };
    let mut keys = object.keys().cloned().collect::<Vec<_>>();
    keys.sort_unstable();
    keys.join(",")
}

fn walk_rootlist_playlists(
    value: &Value,
    output: &mut Vec<EntitySummary>,
    depth: usize,
    username: &str,
) {
    if depth > 32 {
        return;
    }
    match value {
        Value::Array(items) => {
            for item in items {
                walk_rootlist_playlists(item, output, depth + 1, username);
            }
        }
        Value::Object(object) => {
            // Descendants are evaluated first. This makes the smallest
            // playlist metadata record win over a surrounding folder record.
            for nested in object.values() {
                walk_rootlist_playlists(nested, output, depth + 1, username);
            }
            if let Some(entity) = rootlist_entity_from_subtree(value, username) {
                if let Some(existing) = output.iter_mut().find(|item| item.uri == entity.uri) {
                    if existing.can_modify.is_none() {
                        existing.can_modify = entity.can_modify;
                    }
                } else {
                    output.push(entity);
                }
            }
        }
        _ => {}
    }
}

fn rootlist_entity_from_subtree(value: &Value, username: &str) -> Option<EntitySummary> {
    let uri = unique_playlist_uri(value, 5)?;
    let name = rootlist_name(value, 5)?;
    Some(EntitySummary {
        uri,
        name,
        subtitle: Some("Playlist".into()),
        cover_uri: rootlist_cover(value, 5),
        can_modify: super::permissions::playlist_write_access(value, username),
        library: None,
    })
}

fn unique_playlist_uri(value: &Value, max_depth: usize) -> Option<String> {
    let mut uris = Vec::new();
    collect_playlist_uris(value, &mut uris, 0, max_depth);
    uris.sort_unstable();
    uris.dedup();
    (uris.len() == 1).then(|| uris.remove(0))
}

fn collect_playlist_uris(value: &Value, output: &mut Vec<String>, depth: usize, max_depth: usize) {
    if depth > max_depth {
        return;
    }
    match value {
        Value::String(raw) => {
            if let Some(uri) = normalize_rootlist_playlist_uri(raw) {
                output.push(uri);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_playlist_uris(item, output, depth + 1, max_depth);
            }
        }
        Value::Object(object) => {
            for nested in object.values() {
                collect_playlist_uris(nested, output, depth + 1, max_depth);
            }
        }
        _ => {}
    }
}

fn normalize_rootlist_playlist_uri(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if let Some(id) = raw.strip_prefix("spotify:playlist:") {
        return playlist_uri_from_id(id);
    }
    if let Some((_, id)) = raw.rsplit_once(":playlist:") {
        return playlist_uri_from_id(id);
    }
    if let Some((_, id)) = raw.split_once("open.spotify.com/playlist/") {
        return playlist_uri_from_id(id);
    }
    None
}

fn playlist_uri_from_id(raw: &str) -> Option<String> {
    let id = raw
        .split(|character: char| !character.is_ascii_alphanumeric())
        .next()
        .unwrap_or_default();
    (!id.is_empty()).then(|| format!("spotify:playlist:{id}"))
}

fn rootlist_name(value: &Value, max_depth: usize) -> Option<String> {
    rootlist_named_string(value, 0, max_depth, &["name", "title"])
}

fn rootlist_named_string(
    value: &Value,
    depth: usize,
    max_depth: usize,
    keys: &[&str],
) -> Option<String> {
    if depth > max_depth {
        return None;
    }
    let object = value.as_object()?;
    for key in keys {
        if let Some(value) = string_value(object.get(*key)) {
            return Some(value);
        }
    }
    for key in [
        "playlistMetadata",
        "playlist_metadata",
        "metadata",
        "attributes",
        "data",
        "playlist",
    ] {
        if let Some(value) = object.get(key)
            && let Some(found) = rootlist_named_string(value, depth + 1, max_depth, keys)
        {
            return Some(found);
        }
    }
    object
        .values()
        .find_map(|value| rootlist_named_string(value, depth + 1, max_depth, keys))
}

fn rootlist_cover(value: &Value, max_depth: usize) -> Option<String> {
    fn find(value: &Value, depth: usize, max_depth: usize) -> Option<String> {
        if depth > max_depth {
            return None;
        }
        if let Some(cover) =
            image_url(value).and_then(|url| crate::metadata::normalize_cover_url(&url))
        {
            return Some(cover);
        }
        if let Some(url) = string_value(value.get("url"))
            .or_else(|| string_value(value.get("uri")))
            .and_then(|url| crate::metadata::normalize_cover_url(&url))
        {
            return Some(url);
        }
        match value {
            Value::Array(items) => items
                .iter()
                .find_map(|nested| find(nested, depth + 1, max_depth)),
            Value::Object(object) => object
                .values()
                .find_map(|nested| find(nested, depth + 1, max_depth)),
            _ => None,
        }
    }
    find(value, 0, max_depth)
}

fn rootlist_total(value: &Value) -> Option<u32> {
    [
        "length",
        "unfilteredLength",
        "unfiltered_length",
        "unrangedLength",
        "unranged_length",
        "totalLength",
        "total",
    ]
    .into_iter()
    .find_map(|key| value.get(key).and_then(value_u32))
}

fn value_u32(value: &Value) -> Option<u32> {
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .and_then(|value| u32::try_from(value).ok())
}

fn page_from_rootlist<T>(
    request: PageRequest,
    items: Vec<T>,
    total: Option<u32>,
    structure: &RootlistStructure,
) -> Page<T> {
    if structure.items == 0 {
        return page_from_items(request, items, total);
    }
    let offset = structure.pos.unwrap_or(request.offset);
    let consumed = u32::try_from(structure.items).unwrap_or(u32::MAX).max(1);
    let has_more = structure.truncated.unwrap_or(false)
        || total.is_some_and(|total| offset.saturating_add(consumed) < total);
    Page {
        items,
        offset,
        limit: consumed,
        total,
        has_more,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rootlist_preserves_item_rights_and_current_user_ownership() {
        let value = json!({"contents": {
            "items": [
                {"uri": "spotify:playlist:mine"},
                {"uri": "spotify:playlist:shared"},
                {"uri": "spotify:playlist:read-only"}
            ],
            "metaItems": [
                {"attributes":{"name":"Mine"}, "ownerUsername":"me"},
                {"attributes":{"name":"Shared"}, "capabilities":{"canEditItems":true}},
                {"attributes":{"name":"Read only"}, "ownerUsername":"me", "capabilities":{"can_edit_items":false}}
            ]
        }});
        let entities = collect_rootlist_playlists(&value, "me");
        assert_eq!(
            entities.iter().map(|p| p.can_modify).collect::<Vec<_>>(),
            vec![Some(true), Some(true), Some(false)]
        );
    }

    #[test]
    fn recovers_split_and_nested_cosmos_rootlist_playlists() {
        let value = json!({
            "root": {
                "item": [{
                    "playlist": {
                        "rowId": "row-night",
                        "playlistMetadata": {
                            "link": { "uri": "spotify:user:listener:playlist:night" },
                            "name": "Night",
                            "pictures": {
                                "standardLink": "spotify:image:aabbccddeeff00112233445566778899aabbccdd"
                            }
                        }
                    }
                }, {
                    "folder": {
                        "folderMetadata": { "name": "Folder" },
                        "item": [{
                            "playlist": {
                                "row_id": "spotify:playlist:day",
                                "playlist_metadata": { "name": "Day" }
                            }
                        }]
                    }
                }]
            },
            "unfilteredLength": 2
        });
        let entities = collect_rootlist_playlists(&value, "");
        assert_eq!(entities.len(), 2);
        assert_eq!(entities[0].uri, "spotify:playlist:night");
        assert_eq!(entities[0].name, "Night");
        assert_eq!(entities[1].uri, "spotify:playlist:day");
        assert_eq!(entities[1].name, "Day");
        assert_eq!(rootlist_total(&value), Some(2));
    }

    #[test]
    fn pairs_rootlist_items_with_positional_meta_items_and_uses_server_cursor() {
        let value = json!({
            "length": 120,
            "contents": {
                "pos": 50,
                "truncated": true,
                "items": [
                    { "uri": "spotify:user:listener:playlist:night" },
                    { "uri": "spotify:folder:focus" },
                    { "uri": "spotify:playlist:day" }
                ],
                "metaItems": [
                    {
                        "attributes": {
                            "name": "Night",
                            "pictureSize": [{
                                "targetName": "default",
                                "url": "spotify:image:aabbccddeeff00112233445566778899aabbccdd"
                            }]
                        }
                    },
                    { "attributes": { "name": "Focus" } },
                    {
                        "attributes": {
                            "name": "Day",
                            "pictureSize": [{
                                "targetName": "default",
                                "url": "spotify:mosaic:aabbccddeeff00112233445566778899aabbccdd:112233445566778899aabbccddeeff0011223344"
                            }]
                        }
                    }
                ]
            }
        });

        let entities = collect_rootlist_playlists(&value, "");
        assert_eq!(entities.len(), 2);
        assert_eq!(entities[0].uri, "spotify:playlist:night");
        assert_eq!(entities[0].name, "Night");
        assert_eq!(
            entities[0].cover_uri.as_deref(),
            Some("https://i.scdn.co/image/aabbccddeeff00112233445566778899aabbccdd")
        );
        assert_eq!(entities[1].uri, "spotify:playlist:day");
        assert_eq!(entities[1].name, "Day");
        assert_eq!(
            entities[1].cover_uri.as_deref(),
            Some(
                "https://mosaic.scdn.co/300/aabbccddeeff00112233445566778899aabbccdd112233445566778899aabbccddeeff0011223344"
            )
        );

        let structure = rootlist_structure(&value);
        assert_eq!(structure.top_level_length, Some(120));
        assert_eq!(structure.items, 3);
        assert_eq!(structure.meta_items, 3);
        assert_eq!(structure.pos, Some(50));
        assert_eq!(structure.truncated, Some(true));
        assert_eq!(structure.first_item_keys, "uri");
        assert_eq!(structure.first_meta_item_keys, "attributes");

        let page = page_from_rootlist(
            PageRequest {
                offset: 0,
                limit: 50,
            },
            entities,
            rootlist_total(&value),
            &structure,
        );
        assert_eq!(page.offset, 50);
        assert_eq!(page.limit, 3);
        assert_eq!(page.total, Some(120));
        assert!(page.has_more);
    }

    #[test]
    fn keeps_resolved_playlists_when_a_rootlist_page_has_unresolved_rows() {
        let parsed = parse_rootlist_page(
            "",
            PageRequest {
                offset: 0,
                limit: 50,
            },
            &json!({
                "length": 81,
                "contents": {
                    "pos": 0,
                    "truncated": true,
                    "items": [
                        { "uri": "spotify:playlist:night" },
                        { "uri": "spotify:playlist:missing-metadata" },
                        { "uri": "spotify:folder:focus" }
                    ],
                    "metaItems": [
                        { "attributes": { "name": "Night" } },
                        { "statusCode": 404 },
                        { "attributes": { "name": "Focus" } }
                    ]
                }
            }),
            &[],
        );

        assert_eq!(parsed.candidate_count, 2);
        assert_eq!(parsed.unresolved, 1);
        assert_eq!(parsed.page.items.len(), 1);
        assert_eq!(parsed.page.items[0].name, "Night");
        assert_eq!(parsed.page.offset, 0);
        assert_eq!(parsed.page.limit, 3);
        assert_eq!(parsed.page.total, Some(81));
        assert!(parsed.page.has_more);
    }

    #[test]
    fn reads_folders_owner_size_and_added_date_from_the_rootlist() {
        let value = json!({ "contents": {
            "items": [
                { "uri": "spotify:start-group:g1:Sport+%26+Laufen" },
                { "uri": "spotify:playlist:run", "attributes": { "timestamp": "1700000000000" } },
                { "uri": "spotify:end-group:g1" },
                { "uri": "spotify:playlist:weekly" }
            ],
            "metaItems": [
                {},
                { "attributes": { "name": "Run" }, "length": 42, "ownerUsername": "me" },
                {},
                { "attributes": { "name": "Weekly" }, "ownerUsername": "spotify" }
            ]
        }});
        let entities = collect_rootlist_playlists(&value, "me");
        let run = entities[0].library.as_ref().unwrap();
        let weekly = entities[1].library.as_ref().unwrap();

        assert_eq!(entities.len(), 2);
        assert_eq!(run.folder.as_deref(), Some("Sport & Laufen"));
        assert_eq!(run.track_count, Some(42));
        assert_eq!(run.owner, Some(PlaylistOwner::Me));
        assert_eq!(run.added_at, Some(1_700_000_000_000));
        assert_eq!(weekly.folder, None);
        assert_eq!(weekly.owner, Some(PlaylistOwner::Spotify));
    }
}
