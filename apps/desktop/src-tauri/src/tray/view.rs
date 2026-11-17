use luft_librespot::LibrespotPhase;

const TOOLTIP_MAX: usize = 120;
const MENU_MAX: usize = 42;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LibreTrayAction {
    None,
    Login,
    Reconnect,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayView {
    pub is_playing: bool,
    pub now_playing: Option<String>,
    pub librespot_phase: LibrespotPhase,
    /// Click-through is on: the tray offers the way back.
    pub miniplayer_locked: bool,
}

impl Default for TrayView {
    fn default() -> Self {
        Self {
            is_playing: false,
            now_playing: None,
            librespot_phase: LibrespotPhase::NeedsLogin,
            miniplayer_locked: false,
        }
    }
}

impl TrayView {
    #[must_use]
    pub fn playback_enabled(&self) -> bool {
        self.librespot_phase == LibrespotPhase::Ready
    }

    #[must_use]
    pub fn play_pause_label(&self) -> &'static str {
        if self.is_playing {
            "Pause"
        } else {
            "Wiedergeben"
        }
    }

    #[must_use]
    pub fn now_playing_label(&self) -> String {
        match self
            .now_playing
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            Some(text) => ellipsize(text, MENU_MAX),
            None => "Nichts spielt".into(),
        }
    }

    #[must_use]
    pub fn engine_status_label(&self) -> String {
        format!("Librespot · {}", librespot_status(self.librespot_phase))
    }

    #[must_use]
    pub fn tooltip(&self) -> String {
        if let Some(track) = self
            .now_playing
            .as_deref()
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            return ellipsize(track, TOOLTIP_MAX);
        }
        ellipsize(&self.engine_status_label(), TOOLTIP_MAX)
    }

    #[must_use]
    pub fn libre_action(&self) -> LibreTrayAction {
        match self.librespot_phase {
            LibrespotPhase::NeedsLogin => LibreTrayAction::Login,
            LibrespotPhase::Error | LibrespotPhase::Disconnected => LibreTrayAction::Reconnect,
            _ => LibreTrayAction::None,
        }
    }

    #[must_use]
    pub fn libre_action_label(&self) -> Option<&'static str> {
        match self.libre_action() {
            LibreTrayAction::Login => Some("Bei Spotify anmelden"),
            LibreTrayAction::Reconnect => Some("Erneut verbinden"),
            LibreTrayAction::None => None,
        }
    }
}

fn librespot_status(phase: LibrespotPhase) -> &'static str {
    match phase {
        LibrespotPhase::Ready => "Bereit",
        LibrespotPhase::Connecting | LibrespotPhase::Authenticating => "Verbindet",
        LibrespotPhase::NeedsLogin => "Anmeldung nötig",
        LibrespotPhase::Error => "Fehler",
        LibrespotPhase::Disconnected => "Getrennt",
    }
}

fn ellipsize(text: &str, max: usize) -> String {
    if max == 0 {
        return String::new();
    }
    let mut chars = text.chars();
    let taken: String = chars.by_ref().take(max).collect();
    if chars.next().is_none() {
        return taken;
    }
    if max == 1 {
        return "…".into();
    }
    let mut cut: String = taken.chars().take(max.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

#[cfg(test)]
mod tests {
    use super::*;

    fn libre(phase: LibrespotPhase) -> TrayView {
        TrayView {
            librespot_phase: phase,
            ..TrayView::default()
        }
    }

    #[test]
    fn librespot_playback_is_live_when_ready() {
        let view = libre(LibrespotPhase::Ready);
        assert!(view.playback_enabled());
        assert_eq!(view.libre_action(), LibreTrayAction::None);
        assert_eq!(view.engine_status_label(), "Librespot · Bereit");
        assert_eq!(view.tooltip(), "Librespot · Bereit");
    }

    #[test]
    fn librespot_offers_login_or_reconnect() {
        let login = libre(LibrespotPhase::NeedsLogin);
        assert!(!login.playback_enabled());
        assert_eq!(login.libre_action_label(), Some("Bei Spotify anmelden"));
        let reconnect = libre(LibrespotPhase::Disconnected);
        assert_eq!(reconnect.libre_action_label(), Some("Erneut verbinden"));
        assert_eq!(reconnect.libre_action(), LibreTrayAction::Reconnect);
    }

    #[test]
    fn play_pause_and_now_playing_follow_the_current_track() {
        let mut view = libre(LibrespotPhase::Ready);
        assert_eq!(view.play_pause_label(), "Wiedergeben");
        assert_eq!(view.now_playing_label(), "Nichts spielt");
        view.is_playing = true;
        view.now_playing = Some("Nightcall – Kavinsky".into());
        assert_eq!(view.play_pause_label(), "Pause");
        assert_eq!(view.tooltip(), "Nightcall – Kavinsky");
        assert_eq!(view.now_playing_label(), "Nightcall – Kavinsky");
    }

    #[test]
    fn long_titles_are_trimmed_for_the_menu() {
        let view = TrayView {
            now_playing: Some("x".repeat(80)),
            ..libre(LibrespotPhase::Ready)
        };
        assert_eq!(view.now_playing_label().chars().count(), 42);
        assert!(view.now_playing_label().ends_with('…'));
    }
}
