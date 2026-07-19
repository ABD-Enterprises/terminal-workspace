use super::*;

pub(crate) fn trim_security_output(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .trim_end_matches(['\n', '\r'])
        .to_string()
}

pub(crate) fn format_security_error(output: &Output) -> String {
    let stderr = trim_security_output(&output.stderr);
    if stderr.is_empty() {
        format!("security exited with status {}", output.status)
    } else {
        stderr
    }
}

pub(crate) fn security_record_missing(output: &Output) -> bool {
    output.status.code() == Some(44) || format_security_error(output).contains("could not be found")
}

pub(crate) fn run_security_command(args: &[&str]) -> Result<Output, String> {
    Command::new("/usr/bin/security")
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run macOS security CLI: {error}"))
}

/// The classified outcome of reading one keychain item. Callers can tell a
/// genuinely-absent secret (`Missing`) apart from a keychain that is locked or
/// whose access the user denied (`Unavailable`), instead of both collapsing to
/// an opaque error string — so the UI can fall back to prompting for the secret
/// only in the latter case. Carries a stable, machine-branchable distinction.
pub(crate) enum KeychainRead {
    Found(String),
    Missing,
    Unavailable(String),
}

/// Pure classification of a `security find-generic-password` result, split out
/// so it is unit-testable without the CLI or a real keychain.
pub(crate) fn classify_keychain_output(output: &Output) -> KeychainRead {
    if output.status.success() {
        KeychainRead::Found(trim_security_output(&output.stdout))
    } else if security_record_missing(output) {
        KeychainRead::Missing
    } else {
        KeychainRead::Unavailable(format_security_error(output))
    }
}

/// Like `load_keychain_secret`, but distinguishes a locked/denied keychain from
/// a missing record so the caller can react differently.
pub(crate) fn read_keychain_secret(service: &str, account: &str) -> KeychainRead {
    match run_security_command(&["find-generic-password", "-a", account, "-s", service, "-w"]) {
        Ok(output) => classify_keychain_output(&output),
        Err(message) => KeychainRead::Unavailable(message),
    }
}

pub(crate) fn load_keychain_secret(service: &str, account: &str) -> Result<Option<String>, String> {
    let output =
        run_security_command(&["find-generic-password", "-a", account, "-s", service, "-w"])?;
    if output.status.success() {
        return Ok(Some(trim_security_output(&output.stdout)));
    }

    if security_record_missing(&output) {
        return Ok(None);
    }

    Err(format_security_error(&output))
}

pub(crate) fn delete_keychain_secret(service: &str, account: &str) -> Result<(), String> {
    let output = run_security_command(&["delete-generic-password", "-a", account, "-s", service])?;
    if output.status.success() || security_record_missing(&output) {
        return Ok(());
    }

    Err(format_security_error(&output))
}

pub(crate) fn store_keychain_secret(
    service: &str,
    account: &str,
    value: &str,
) -> Result<(), String> {
    if value.is_empty() {
        return delete_keychain_secret(service, account);
    }

    let output = run_security_command(&[
        "add-generic-password",
        "-a",
        account,
        "-s",
        service,
        "-w",
        value,
        "-U",
    ])?;
    if output.status.success() {
        return Ok(());
    }

    Err(format_security_error(&output))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;
    use std::process::{ExitStatus, Output};

    fn security_output(code: i32, stdout: &str, stderr: &str) -> Output {
        Output {
            // On unix a normally-exited process with code N has wait status N<<8.
            status: ExitStatus::from_raw(code << 8),
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
        }
    }

    #[test]
    fn classify_keychain_output_distinguishes_found_missing_unavailable() {
        // Success with a value => Found.
        assert!(matches!(
            classify_keychain_output(&security_output(0, "s3cr3t\n", "")),
            KeychainRead::Found(v) if v == "s3cr3t"
        ));
        // Exit 44 => the record is simply absent.
        assert!(matches!(
            classify_keychain_output(&security_output(44, "", "")),
            KeychainRead::Missing
        ));
        // "could not be found" stderr => absent even with a different exit code.
        assert!(matches!(
            classify_keychain_output(&security_output(
                1,
                "",
                "The specified item could not be found in the keychain."
            )),
            KeychainRead::Missing
        ));
        // A locked keychain / denied access (any other non-zero) => Unavailable,
        // NOT Missing — so the caller prompts instead of silently using no secret.
        match classify_keychain_output(&security_output(51, "", "User interaction is not allowed.")) {
            KeychainRead::Unavailable(message) => {
                assert!(message.contains("User interaction is not allowed."))
            }
            _ => panic!("a locked/denied keychain must classify as Unavailable"),
        }
    }
}
