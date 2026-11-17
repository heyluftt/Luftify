use http::Method;
use librespot::core::Session;
use luft_core::{EntitySummary, Page, PageRequest};
use serde_json::Value;

use crate::session_http;

use super::{
    entity_from_value, items, page_from_items, string_value, unwrap_node, urlencoding_lite,
};

pub(crate) async fn new_releases(
    session: &Session,
    request: PageRequest,
) -> Result<Page<EntitySummary>, luft_core::ProviderError> {
    let request = PageRequest {
        offset: request.offset,
        limit: request.limit.clamp(1, 20),
    };
    if super::artist_releases::warming_up(session) {
        return Ok(page_from_items(request, Vec::new(), None));
    }
    if let Some(page) = super::artist_releases::new_releases(session, &request).await {
        return Ok(page);
    }
    // The Web API search is mostly refused for this client; kept as a fallback.
    if let Some(page) = search_new_albums(session, &request, "tag:new", None).await
        && !page.items.is_empty()
    {
        return Ok(page);
    }
    if let Some(page) = search_new_albums(
        session,
        &request,
        &format!("year:{}", chrono::Utc::now().format("%Y")),
        Some(90),
    )
    .await
        && !page.items.is_empty()
    {
        return Ok(page);
    }
    Err(luft_core::ProviderError::ActionRejected {
        message: "Neuerscheinungen sind gerade nicht erreichbar.".into(),
        retryable: true,
    })
}

async fn search_new_albums(
    session: &Session,
    request: &PageRequest,
    query: &str,
    max_age_days: Option<i64>,
) -> Option<Page<EntitySummary>> {
    let search_limit = request.limit.clamp(1, 10);
    let url = format!(
        "https://api.spotify.com/v1/search?q={}&type=album&limit={}&offset={}",
        urlencoding_lite(query),
        search_limit,
        request.offset
    );
    let bytes = session_http::request(session, &Method::GET, &url, None).await?;
    let value = serde_json::from_slice::<Value>(&bytes).ok()?;
    let mut page = page_from_album_payload(&value, *request, max_age_days);
    page.items.truncate(request.limit.max(1) as usize);
    Some(page)
}

#[cfg(test)]
pub(crate) fn page_from_new_releases(value: &Value, request: PageRequest) -> Page<EntitySummary> {
    page_from_album_payload(value, request, None)
}

fn page_from_album_payload(
    value: &Value,
    request: PageRequest,
    max_age_days: Option<i64>,
) -> Page<EntitySummary> {
    let albums = value.get("albums").unwrap_or(value);
    page_from_items(
        request,
        items(albums)
            .into_iter()
            .filter(|item| max_age_days.is_none_or(|days| album_released_within(item, days)))
            .filter_map(entity_from_value)
            .collect(),
        albums
            .get("total")
            .and_then(Value::as_u64)
            .map(|n| n as u32),
    )
}

fn album_released_within(value: &Value, max_age_days: i64) -> bool {
    let record = unwrap_node(value);
    let Some(raw) = string_value(record.get("release_date")) else {
        return true;
    };
    let parsed = chrono::NaiveDate::parse_from_str(&raw, "%Y-%m-%d")
        .or_else(|_| chrono::NaiveDate::parse_from_str(&format!("{raw}-01"), "%Y-%m-%d"))
        .or_else(|_| chrono::NaiveDate::parse_from_str(&format!("{raw}-01-01"), "%Y-%m-%d"));
    let Ok(date) = parsed else {
        return true;
    };
    let age = chrono::Utc::now()
        .date_naive()
        .signed_duration_since(date)
        .num_days();
    age >= -1 && age <= max_age_days
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_web_api_new_releases() {
        let page = page_from_new_releases(
            &json!({
                "albums": {
                    "items": [{
                        "album_type": "album",
                        "artists": [{ "name": "Kavinsky", "uri": "spotify:artist:k" }],
                        "id": "nightcall",
                        "images": [{ "url": "https://i.scdn.co/image/night" }],
                        "name": "Nightcall",
                        "uri": "spotify:album:nightcall"
                    }],
                    "limit": 12,
                    "offset": 0,
                    "total": 1
                }
            }),
            PageRequest {
                offset: 0,
                limit: 12,
            },
        );
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].uri, "spotify:album:nightcall");
        assert_eq!(page.items[0].name, "Nightcall");
        assert_eq!(page.items[0].subtitle.as_deref(), Some("Kavinsky"));
        assert!(!page.has_more);
    }

    #[test]
    fn parses_web_api_album_search_as_new_releases() {
        let page = page_from_new_releases(
            &json!({
                "albums": {
                    "items": [{
                        "artists": [{ "name": "Justice", "uri": "spotify:artist:j" }],
                        "id": "hyperdrama",
                        "name": "Hyperdrama",
                        "release_date": "2026-08-01",
                        "uri": "spotify:album:hyperdrama"
                    }],
                    "total": 1
                }
            }),
            PageRequest {
                offset: 0,
                limit: 12,
            },
        );
        assert_eq!(page.items[0].name, "Hyperdrama");
        assert_eq!(page.items[0].uri, "spotify:album:hyperdrama");
    }

    #[test]
    fn year_fallback_keeps_only_recent_albums() {
        let page = page_from_album_payload(
            &json!({
                "albums": {
                    "items": [
                        {
                            "name": "This Week",
                            "uri": "spotify:album:new",
                            "release_date": chrono::Utc::now().format("%Y-%m-%d").to_string(),
                            "artists": [{ "name": "Now" }]
                        },
                        {
                            "name": "Last Year",
                            "uri": "spotify:album:old",
                            "release_date": "2025-01-01",
                            "artists": [{ "name": "Then" }]
                        }
                    ]
                }
            }),
            PageRequest {
                offset: 0,
                limit: 12,
            },
            Some(90),
        );
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].name, "This Week");
    }
}
