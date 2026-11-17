use super::{LrcLibResponse, LyricsDocument, LyricsLine};

pub(super) fn normalize_response(payload: LrcLibResponse) -> LyricsDocument {
    let synced_lines = payload
        .synced_lyrics
        .as_deref()
        .map(parse_synced_lyrics)
        .unwrap_or_default();
    let synced = !synced_lines.is_empty();
    let lines = if synced {
        synced_lines
    } else {
        payload
            .plain_lyrics
            .unwrap_or_default()
            .lines()
            .filter_map(|line| {
                let text = line.trim();
                (!text.is_empty()).then(|| LyricsLine {
                    start_ms: None,
                    text: text.to_owned(),
                })
            })
            .collect()
    };
    LyricsDocument {
        provider: "LRCLIB".into(),
        synced,
        instrumental: payload.instrumental,
        lines,
    }
}

pub(super) fn has_usable_synced_lyrics(value: &str) -> bool {
    !parse_synced_lyrics(value).is_empty()
}

fn parse_synced_lyrics(value: &str) -> Vec<LyricsLine> {
    let mut lines = Vec::new();
    for raw in value.lines() {
        let mut rest = raw.trim();
        let mut timestamps = Vec::new();
        while let Some(after_open) = rest.strip_prefix('[') {
            let Some(close) = after_open.find(']') else {
                break;
            };
            let timestamp = &after_open[..close];
            let Some(start_ms) = parse_timestamp(timestamp) else {
                break;
            };
            timestamps.push(start_ms);
            rest = after_open[close + 1..].trim_start();
        }
        if timestamps.is_empty() || rest.is_empty() {
            continue;
        }
        for start_ms in timestamps {
            lines.push(LyricsLine {
                start_ms: Some(start_ms),
                text: rest.to_owned(),
            });
        }
    }
    lines.sort_by_key(|line| line.start_ms);
    lines
}

fn parse_timestamp(value: &str) -> Option<u64> {
    let (minutes, seconds) = value.split_once(':')?;
    let minutes = minutes.parse::<u64>().ok()?;
    let seconds = seconds.parse::<f64>().ok()?;
    if !seconds.is_finite() || !(0.0..60.0).contains(&seconds) {
        return None;
    }
    Some(
        minutes
            .saturating_mul(60_000)
            .saturating_add((seconds * 1_000.0).round() as u64),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_orders_lrc_timestamps() {
        let lines = parse_synced_lyrics("[00:12.50]Second\n[00:01.02][00:03.00]First");
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].start_ms, Some(1_020));
        assert_eq!(lines[1].start_ms, Some(3_000));
        assert_eq!(lines[2].text, "Second");
    }

    #[test]
    fn ignores_metadata_and_empty_lines() {
        let lines = parse_synced_lyrics("[ar:Artist]\n[00:01.00]   \n[00:02.00]Text");
        assert_eq!(
            lines,
            vec![LyricsLine {
                start_ms: Some(2_000),
                text: "Text".into()
            }]
        );
    }

    #[test]
    fn plain_lyrics_remain_unsynced() {
        let document = normalize_response(LrcLibResponse {
            instrumental: false,
            track_name: None,
            artist_name: None,
            album_name: None,
            duration: None,
            plain_lyrics: Some("Line one\n\nLine two".into()),
            synced_lyrics: None,
        });
        assert!(!document.synced);
        assert_eq!(document.lines.len(), 2);
        assert!(document.lines.iter().all(|line| line.start_ms.is_none()));
    }

    #[test]
    fn invalid_synced_lyrics_fall_back_to_plain_lyrics() {
        let document = normalize_response(LrcLibResponse {
            instrumental: false,
            track_name: None,
            artist_name: None,
            album_name: None,
            duration: None,
            plain_lyrics: Some("Plain line one\nPlain line two".into()),
            synced_lyrics: Some("[ar:Artist]\n[00:01.00]   \nnot an lrc line".into()),
        });

        assert!(!document.synced);
        assert_eq!(
            document
                .lines
                .iter()
                .map(|line| line.text.as_str())
                .collect::<Vec<_>>(),
            vec!["Plain line one", "Plain line two"]
        );
        assert!(document.lines.iter().all(|line| line.start_ms.is_none()));
    }
}
