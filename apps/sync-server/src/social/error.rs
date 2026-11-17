use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use luft_listen_together::social::SocialError;

pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug)]
pub struct ApiError {
    pub(super) status: StatusCode,
    pub(super) code: &'static str,
}

impl ApiError {
    pub fn bad(code: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code,
        }
    }
    pub fn denied(code: &'static str) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code,
        }
    }
    pub fn missing(code: &'static str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code,
        }
    }
    pub fn unauthorized() -> Self {
        Self {
            status: StatusCode::UNAUTHORIZED,
            code: "unauthorized",
        }
    }
    pub fn limited() -> Self {
        Self {
            status: StatusCode::TOO_MANY_REQUESTS,
            code: "limitReached",
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(_: sqlx::Error) -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "unavailable",
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(SocialError {
                code: self.code.into(),
            }),
        )
            .into_response()
    }
}
