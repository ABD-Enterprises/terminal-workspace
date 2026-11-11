//! A renderer request alone cannot authorize releasing a saved credential.
//! Approval is native, belongs to this one response, and is never cached here.

use std::sync::atomic::{AtomicBool, Ordering};

use rfd::{AsyncMessageDialog, MessageButtons, MessageDialogResult};
use tauri::Manager;

use crate::{IpcError, IpcErrorCode};

static PROMPT_OPEN: AtomicBool = AtomicBool::new(false);

struct PromptGuard<'a>(&'a AtomicBool);

impl Drop for PromptGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn approve_once(prompt_open: &AtomicBool, approve: impl FnOnce() -> bool) -> Result<(), IpcError> {
    prompt_open
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .map_err(|_| {
            IpcError::new(
                IpcErrorCode::Refused,
                "A saved-credential request is already awaiting approval.",
            )
        })?;
    let _guard = PromptGuard(prompt_open);
    if approve() {
        Ok(())
    } else {
        Err(IpcError::new(
            IpcErrorCode::Refused,
            "Access to the saved credential was not approved.",
        ))
    }
}

/// Call only on a blocking worker, never the app's event-loop thread. The
/// strings are native constants, not caller-controlled prompt text. No dialog
/// permissions are granted to the renderer.
pub(crate) fn require_credential_consent(app: &tauri::AppHandle) -> Result<(), IpcError> {
    let window = app.get_webview_window("main").ok_or_else(|| {
        IpcError::new(
            IpcErrorCode::Refused,
            "The app window is unavailable for credential approval.",
        )
    })?;
    approve_once(&PROMPT_OPEN, || {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        // Create the native sheet on the UI thread and await its result off
        // that thread. Using rfd directly avoids installing JavaScript hooks
        // (the dialog plugin replaces window.confirm with an async function).
        if app.run_on_main_thread(move || {
            let result = AsyncMessageDialog::new()
                .set_description("Allow this app to read a saved SSH password or passphrase?\n\nOnly allow this if you intended to use saved credentials. The credential will be available to the app for this session.")
                .set_title("Use saved SSH credentials")
                .set_parent(&window)
                .set_buttons(MessageButtons::OkCancelCustom("Allow once".into(), "Cancel".into()))
                .show();
            tauri::async_runtime::spawn(async move {
                let approved = matches!(result.await, MessageDialogResult::Custom(label) if label == "Allow once");
                let _ = send.send(approved);
            });
        }).is_err() {
            return false;
        }
        receive.recv().unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_fails_closed_and_releases_prompt_slot() {
        let open = AtomicBool::new(false);
        assert_eq!(
            approve_once(&open, || false).unwrap_err().code,
            IpcErrorCode::Refused
        );
        assert!(!open.load(Ordering::Acquire));
        assert!(approve_once(&open, || true).is_ok());
    }

    #[test]
    fn approval_is_not_reused() {
        let open = AtomicBool::new(false);
        assert!(approve_once(&open, || true).is_ok());
        assert!(approve_once(&open, || false).is_err());
    }

    #[test]
    fn concurrent_requests_cannot_queue_or_share_an_approval() {
        let open = AtomicBool::new(false);
        assert!(approve_once(&open, || {
            assert!(approve_once(&open, || panic!("must not open another prompt")).is_err());
            true
        })
        .is_ok());
        assert!(!open.load(Ordering::Acquire));
    }
}
