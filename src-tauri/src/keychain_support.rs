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

fn kill_and_reap_security_child(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn run_security_command_with_secret<F>(
    args: &[&str],
    value: &str,
    before_write: F,
) -> Result<Output, String>
where
    F: FnOnce(u32) -> Result<(), String>,
{
    let mut child = Command::new("/usr/bin/security")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to run macOS security CLI: {error}"))?;

    if let Err(error) = before_write(child.id()) {
        kill_and_reap_security_child(&mut child);
        return Err(error);
    }

    let Some(mut stdin) = child.stdin.take() else {
        kill_and_reap_security_child(&mut child);
        return Err("Failed to open stdin for macOS security CLI".to_string());
    };

    // The interactive form asks for the password and then confirmation.
    if let Err(error) = stdin
        .write_all(value.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.write_all(value.as_bytes()))
        .and_then(|_| stdin.write_all(b"\n"))
    {
        drop(stdin);
        kill_and_reap_security_child(&mut child);
        return Err(format!(
            "Failed to send secret to macOS security CLI: {error}"
        ));
    }
    drop(stdin);

    child
        .wait_with_output()
        .map_err(|error| format!("Failed to wait for macOS security CLI: {error}"))
}

/// The classified outcome of reading one keychain item. Callers can tell a
/// genuinely-absent secret (`Missing`) apart from a keychain that is locked or
/// whose access the user denied (`Unavailable`), instead of both collapsing to
/// an opaque error string — so the UI can fall back to prompting for the secret
/// only in the latter case. Carries a stable, machine-branchable distinction.
pub(crate) enum KeychainRead {
    Found(String),
    Missing,
    // #157: production reduces this to a boolean at main.rs, so the payload is
    // dead outside tests — but classify_keychain_output's tests destructure it
    // to prove a locked keychain stays distinguishable from a missing secret.
    // Surfacing the message to the renderer would be a behaviour change, so the
    // honest move is to keep the diagnostic and scope the allow, not delete it.
    #[cfg_attr(not(test), allow(dead_code))]
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
    store_keychain_secret_with_observer(service, account, value, |_| Ok(()))
}

fn store_keychain_secret_with_observer<F>(
    service: &str,
    account: &str,
    value: &str,
    before_write: F,
) -> Result<(), String>
where
    F: FnOnce(u32) -> Result<(), String>,
{
    if value.is_empty() {
        return delete_keychain_secret(service, account);
    }

    if value.contains(['\r', '\n']) {
        return Err("Keychain secrets cannot contain line breaks".to_string());
    }

    let output = run_security_command_with_secret(
        &[
            "add-generic-password",
            "-a",
            account,
            "-s",
            service,
            "-U",
            "-w",
        ],
        value,
        before_write,
    )?;
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

    #[cfg(target_os = "macos")]
    const KEYCHAIN_TEST_CHILD: &str = "TERMSNIP_KEYCHAIN_TEST_CHILD";

    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        fn setsid() -> std::ffi::c_int;
        fn sysctl(
            name: *mut std::ffi::c_int,
            namelen: u32,
            oldp: *mut std::ffi::c_void,
            oldlenp: *mut usize,
            newp: *mut std::ffi::c_void,
            newlen: usize,
        ) -> std::ffi::c_int;
    }

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
        match classify_keychain_output(&security_output(51, "", "User interaction is not allowed."))
        {
            KeychainRead::Unavailable(message) => {
                assert!(message.contains("User interaction is not allowed."))
            }
            _ => panic!("a locked/denied keychain must classify as Unavailable"),
        }
    }

    #[test]
    fn store_keychain_secret_rejects_line_bearing_values() {
        for value in ["secret\nnext-line", "secret\rnext-line"] {
            let error = store_keychain_secret("unused-service", "unused-account", value)
                .expect_err("line-bearing keychain values must be rejected before spawning");
            assert_eq!(error, "Keychain secrets cannot contain line breaks");
        }
    }

    #[cfg(target_os = "macos")]
    fn live_process_argv(pid: u32) -> Result<Vec<String>, String> {
        const CTL_KERN: std::ffi::c_int = 1;
        const KERN_PROCARGS2: std::ffi::c_int = 49;

        let mut mib = [CTL_KERN, KERN_PROCARGS2, pid as std::ffi::c_int];
        let mut size = 0usize;
        let size_status = unsafe {
            sysctl(
                mib.as_mut_ptr(),
                mib.len() as u32,
                std::ptr::null_mut(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if size_status != 0 {
            return Err(format!(
                "Failed to size KERN_PROCARGS2 for security child {pid}: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut bytes = vec![0u8; size];
        let read_status = unsafe {
            sysctl(
                mib.as_mut_ptr(),
                mib.len() as u32,
                bytes.as_mut_ptr().cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        if read_status != 0 {
            return Err(format!(
                "Failed to read KERN_PROCARGS2 for security child {pid}: {}",
                std::io::Error::last_os_error()
            ));
        }
        bytes.truncate(size);

        let argc_size = std::mem::size_of::<std::ffi::c_int>();
        if bytes.len() < argc_size {
            return Err(format!(
                "KERN_PROCARGS2 for security child {pid} did not contain argc"
            ));
        }
        let argc = std::ffi::c_int::from_ne_bytes(
            bytes[..argc_size]
                .try_into()
                .map_err(|_| "Failed to decode KERN_PROCARGS2 argc".to_string())?,
        );
        if argc < 1 {
            return Err(format!(
                "KERN_PROCARGS2 for security child {pid} reported invalid argc {argc}"
            ));
        }

        let mut cursor = argc_size;
        while cursor < bytes.len() && bytes[cursor] != 0 {
            cursor += 1;
        }
        while cursor < bytes.len() && bytes[cursor] == 0 {
            cursor += 1;
        }

        let mut argv = Vec::with_capacity(argc as usize);
        for _ in 0..argc {
            let start = cursor;
            while cursor < bytes.len() && bytes[cursor] != 0 {
                cursor += 1;
            }
            if start == cursor {
                break;
            }
            argv.push(String::from_utf8_lossy(&bytes[start..cursor]).into_owned());
            while cursor < bytes.len() && bytes[cursor] == 0 {
                cursor += 1;
            }
        }

        if argv.len() != argc as usize {
            return Err(format!(
                "KERN_PROCARGS2 for security child {pid} reported {argc} args but exposed {}",
                argv.len()
            ));
        }
        Ok(argv)
    }

    #[cfg(target_os = "macos")]
    fn assert_security_success(args: &[&str]) -> Output {
        let output = run_security_command(args).expect("security CLI should spawn");
        assert!(
            output.status.success(),
            "security {args:?} failed: {}",
            format_security_error(&output)
        );
        output
    }

    #[cfg(target_os = "macos")]
    fn run_isolated_keychain_child() {
        let tty = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open("/dev/tty");
        assert!(
            tty.is_err(),
            "the isolated GUI-equivalent test process unexpectedly acquired a controlling TTY"
        );

        let mut inherited_stdin_byte = [0u8; 1];
        let inherited_stdin_read =
            std::io::Read::read(&mut std::io::stdin(), &mut inherited_stdin_byte)
                .expect("the nulled inherited stdin should be readable as EOF");
        assert_eq!(
            inherited_stdin_read, 0,
            "the isolated test process must inherit /dev/null as stdin"
        );

        let isolated_home =
            std::path::PathBuf::from(std::env::var_os("HOME").expect("isolated HOME must be set"));
        assert_eq!(
            std::env::var_os("CFFIXED_USER_HOME").as_deref(),
            Some(isolated_home.as_os_str()),
            "CoreFoundation and POSIX home resolution must share the isolated home"
        );

        let keychain_dir = isolated_home.join("Library/Keychains");
        std::fs::create_dir_all(&keychain_dir)
            .expect("isolated keychain directory should be created");
        std::fs::create_dir_all(isolated_home.join("Library/Preferences"))
            .expect("isolated preferences directory should be created");
        let keychain_path = keychain_dir.join("termsnip-argv-test.keychain-db");
        let keychain_arg = keychain_path
            .to_str()
            .expect("temporary keychain path should be UTF-8");
        let keychain_password = "termsnip-isolated-keychain-password";

        assert_security_success(&["create-keychain", "-p", keychain_password, keychain_arg]);
        assert_security_success(&["list-keychains", "-d", "user", "-s", keychain_arg]);
        assert_security_success(&["default-keychain", "-d", "user", "-s", keychain_arg]);
        assert_security_success(&["unlock-keychain", "-p", keychain_password, keychain_arg]);

        let isolated_default = assert_security_success(&["default-keychain", "-d", "user"]);
        assert!(
            trim_security_output(&isolated_default.stdout).contains(keychain_arg),
            "the default keychain inside the isolated home must be the throwaway keychain"
        );

        let service = format!("com.termsnip.argv-test.{}", std::process::id());
        let account = format!("argv-test-account-{}", std::process::id());
        let sentinel = "TS_KEYCHAIN_ARGV_SENTINEL_318_9f31a7c2";

        store_keychain_secret(&service, &account, "initial-value")
            .expect("the initial isolated keychain item should be created");

        let mut observed_argv = Vec::new();
        let mut sentinel_seen = false;
        let store_result =
            store_keychain_secret_with_observer(&service, &account, sentinel, |pid| {
                // The child is blocked waiting for its piped stdin here. Inspect
                // its live kernel argv before allowing any secret bytes to be written.
                observed_argv = live_process_argv(pid)?;
                sentinel_seen = observed_argv.iter().any(|arg| arg.contains(sentinel));
                if sentinel_seen {
                    return Err(format!(
                        "live security argv exposed the keychain sentinel: {observed_argv:?}"
                    ));
                }
                Ok(())
            });

        assert!(
            !sentinel_seen,
            "the planted sentinel must be absent from the live security child argv"
        );
        store_result.expect("updating the isolated keychain item through stdin should succeed");
        assert_eq!(
            observed_argv,
            vec![
                "/usr/bin/security".to_string(),
                "add-generic-password".to_string(),
                "-a".to_string(),
                account.clone(),
                "-s".to_string(),
                service.clone(),
                "-U".to_string(),
                "-w".to_string(),
            ],
            "the live child must preserve upsert and prompt without carrying the value"
        );

        assert_eq!(
            load_keychain_secret(&service, &account)
                .expect("the isolated keychain item should be readable"),
            Some(sentinel.to_string()),
            "the stdin-delivered secret should round-trip through the real keychain"
        );
        delete_keychain_secret(&service, &account)
            .expect("the isolated keychain item should be deleted");
        assert_eq!(
            load_keychain_secret(&service, &account)
                .expect("the deleted isolated keychain item should be queryable"),
            None
        );

        assert_security_success(&["delete-keychain", keychain_arg]);
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn keychain_secret_round_trip_hides_value_from_live_argv_without_a_tty() {
        if std::env::var_os(KEYCHAIN_TEST_CHILD).is_some() {
            run_isolated_keychain_child();
            return;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be after the Unix epoch")
            .as_nanos();
        let isolated_home = std::env::temp_dir().join(format!(
            "termsnip-keychain-argv-test-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&isolated_home)
            .expect("isolated keychain test home should be created");

        let mut command =
            Command::new(std::env::current_exe().expect("the Rust test executable should resolve"));
        command
            .arg("--exact")
            .arg(
                "keychain_support::tests::keychain_secret_round_trip_hides_value_from_live_argv_without_a_tty",
            )
            .arg("--nocapture")
            .env(KEYCHAIN_TEST_CHILD, "1")
            .env("HOME", &isolated_home)
            .env("CFFIXED_USER_HOME", &isolated_home)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                if setsid() == -1 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }

        let output = command.output();
        let cleanup = std::fs::remove_dir_all(&isolated_home);
        let output = output.expect("the no-TTY keychain test child should start");
        cleanup.expect("the isolated keychain test home should be removable");

        assert!(
            output.status.success(),
            "isolated no-TTY keychain child failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
