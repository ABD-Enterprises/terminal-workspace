//! #203 (slice 1): a typed error that crosses the IPC boundary with a stable
//! `code` the renderer can branch on, instead of parsing prose. Codes are the
//! SAME names `apps/desktop/src/lib/ssh-error-classifier.ts` already uses for
//! its categories, so the frontend classifier can read the code first and fall
//! back to its regex rules for the commands not yet migrated.
//!
//! The `message` keeps the exact string the command returned before, so the
//! renderer shows the same text; `Display`/`contains` let existing callers and
//! fixtures keep treating the error like the `String` it used to be.

use std::{fmt, io};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IpcErrorCode {
    AuthFailed,
    HostKeyMismatch,
    NetworkUnreachable,
    Timeout,
    Refused,
    DnsFailure,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct IpcError {
    pub code: IpcErrorCode,
    pub message: String,
}

impl IpcError {
    pub fn new(code: IpcErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(IpcErrorCode::Internal, message)
    }

    /// Fixtures used to receive a `String`; keep that shape usable in tests.
    #[cfg(test)]
    pub fn contains(&self, needle: &str) -> bool {
        self.message.contains(needle)
    }
}

impl fmt::Display for IpcError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl From<String> for IpcError {
    fn from(message: String) -> Self {
        Self::internal(message)
    }
}

impl From<&str> for IpcError {
    fn from(message: &str) -> Self {
        Self::internal(message)
    }
}

impl From<io::Error> for IpcError {
    fn from(error: io::Error) -> Self {
        Self::new(classify_transport_error(&error), error.to_string())
    }
}

/// Map a socket-level failure to its stable code. Anything not obviously a
/// network condition stays `internal` so the renderer's prose fallback still
/// sees the original text.
pub fn classify_transport_error(error: &io::Error) -> IpcErrorCode {
    match error.kind() {
        io::ErrorKind::TimedOut => IpcErrorCode::Timeout,
        io::ErrorKind::ConnectionRefused => IpcErrorCode::Refused,
        io::ErrorKind::NetworkUnreachable | io::ErrorKind::HostUnreachable => {
            IpcErrorCode::NetworkUnreachable
        }
        _ => IpcErrorCode::Internal,
    }
}

// libssh2 session error codes (libssh2.h); libssh2-sys is not a direct
// dependency, so the handful we branch on are spelled out here.
const LIBSSH2_ERROR_TIMEOUT: i32 = -9;
const LIBSSH2_ERROR_SOCKET_DISCONNECT: i32 = -13;
const LIBSSH2_ERROR_AUTHENTICATION_FAILED: i32 = -18;
const LIBSSH2_ERROR_PUBLICKEY_UNVERIFIED: i32 = -19;
const LIBSSH2_ERROR_SOCKET_TIMEOUT: i32 = -30;

/// Map an ssh2 failure at the handshake/auth boundary to its stable code.
pub fn classify_ssh2_error(error: &ssh2::Error) -> IpcErrorCode {
    match error.code() {
        ssh2::ErrorCode::Session(LIBSSH2_ERROR_AUTHENTICATION_FAILED)
        | ssh2::ErrorCode::Session(LIBSSH2_ERROR_PUBLICKEY_UNVERIFIED) => IpcErrorCode::AuthFailed,
        ssh2::ErrorCode::Session(LIBSSH2_ERROR_TIMEOUT)
        | ssh2::ErrorCode::Session(LIBSSH2_ERROR_SOCKET_TIMEOUT) => IpcErrorCode::Timeout,
        ssh2::ErrorCode::Session(LIBSSH2_ERROR_SOCKET_DISCONNECT) => {
            IpcErrorCode::NetworkUnreachable
        }
        _ => IpcErrorCode::Internal,
    }
}

impl From<ssh2::Error> for IpcError {
    fn from(error: ssh2::Error) -> Self {
        Self::new(classify_ssh2_error(&error), error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code_json(error: &IpcError) -> String {
        serde_json::to_value(error).expect("serializes")["code"]
            .as_str()
            .expect("code is a string")
            .to_owned()
    }

    #[test]
    fn transport_kinds_serialize_to_frontend_category_names() {
        for (kind, expected) in [
            (io::ErrorKind::TimedOut, "timeout"),
            (io::ErrorKind::ConnectionRefused, "refused"),
            (io::ErrorKind::NetworkUnreachable, "network_unreachable"),
            (io::ErrorKind::HostUnreachable, "network_unreachable"),
            (io::ErrorKind::PermissionDenied, "internal"),
        ] {
            let error = IpcError::from(io::Error::new(kind, "x"));
            assert_eq!(code_json(&error), expected, "{kind:?}");
        }
    }

    #[test]
    fn ssh2_auth_failure_serializes_to_auth_failed() {
        let error = IpcError::from(ssh2::Error::new(
            ssh2::ErrorCode::Session(LIBSSH2_ERROR_AUTHENTICATION_FAILED),
            "auth",
        ));
        assert_eq!(code_json(&error), "auth_failed");
        let other = IpcError::from(ssh2::Error::new(ssh2::ErrorCode::Session(-1), "banner"));
        assert_eq!(code_json(&other), "internal");
    }

    #[test]
    fn string_errors_keep_their_text_and_are_internal() {
        let error: IpcError = "Session not found in native runtime".to_string().into();
        assert_eq!(code_json(&error), "internal");
        assert_eq!(error.to_string(), "Session not found in native runtime");
        assert!(error.contains("not found"));
    }
}
