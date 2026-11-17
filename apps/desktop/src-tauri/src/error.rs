use luft_core::ProviderError;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

impl CommandError {
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            code: "INTERNAL_ERROR",
            message: message.into(),
            retryable: false,
        }
    }
}

impl From<ProviderError> for CommandError {
    fn from(value: ProviderError) -> Self {
        match value {
            ProviderError::CapabilityUnavailable => Self {
                code: "CAPABILITY_UNAVAILABLE",
                message: "Diese Funktion ist gerade nicht verfügbar.".into(),
                retryable: false,
            },
            ProviderError::Disconnected => Self {
                code: "ENGINE_DISCONNECTED",
                message: "Die Libre-Sitzung ist nicht verbunden.".into(),
                retryable: true,
            },
            ProviderError::Timeout => Self {
                code: "REQUEST_TIMEOUT",
                message: "Die Wiedergabe-Engine hat nicht rechtzeitig geantwortet.".into(),
                retryable: true,
            },
            ProviderError::InvalidRequest(_) => Self {
                code: "INVALID_REQUEST",
                message: "Die Anfrage enthält ungültige Werte.".into(),
                retryable: false,
            },
            ProviderError::ActionRejected { message, retryable } => Self {
                code: "ACTION_REJECTED",
                message,
                retryable,
            },
            ProviderError::Internal(_) => Self::internal(
                "Die Aktion konnte nicht abgeschlossen werden. Technische Details wurden protokolliert.",
            ),
        }
    }
}
