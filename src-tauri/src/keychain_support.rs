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

const SECURITY_CHILD_CLEANUP_TIMEOUT: Duration = Duration::from_millis(500);
const SECURITY_CHILD_CLEANUP_RETRY_TIMEOUT: Duration = Duration::from_secs(5);
const SECURITY_CHILD_CLEANUP_POLL_INTERVAL: Duration = Duration::from_millis(10);
const SECURITY_CLEANUP_SWEEP_INTERVAL: Duration = Duration::from_millis(100);
const MAX_RETAINED_SECURITY_CLEANUPS: usize = 16;

trait SecurityChildControl {
    fn kill(&mut self) -> io::Result<()>;
    fn try_wait(&mut self) -> io::Result<Option<std::process::ExitStatus>>;
}

impl SecurityChildControl for std::process::Child {
    fn kill(&mut self) -> io::Result<()> {
        std::process::Child::kill(self)
    }

    fn try_wait(&mut self) -> io::Result<Option<std::process::ExitStatus>> {
        std::process::Child::try_wait(self)
    }
}

enum SecurityChildCleanupEvent {
    KillFailed(String),
    PollFailed(String),
    Reaped,
    RetryBudgetExhausted { retained: bool },
}

trait RetainedSecurityCleanup: Send {
    fn sweep(&mut self) -> bool;
}

struct RetainedSecurityReader {
    stream_name: &'static str,
    handle: thread::JoinHandle<io::Result<Vec<u8>>>,
}

impl RetainedSecurityReader {
    fn new(stream_name: &'static str, handle: thread::JoinHandle<io::Result<Vec<u8>>>) -> Self {
        Self {
            stream_name,
            handle,
        }
    }

    fn finish(self) -> Result<Vec<u8>, String> {
        self.handle
            .join()
            .map_err(|_| format!("macOS security {} reader panicked", self.stream_name))?
            .map_err(|error| {
                format!(
                    "Failed to read {} from macOS security CLI: {error}",
                    self.stream_name
                )
            })
    }

    fn sweep(&mut self) -> bool {
        if !self.handle.is_finished() {
            return false;
        }

        let handle = std::mem::replace(&mut self.handle, thread::spawn(|| Ok(Vec::new())));
        if let Err(error) = handle
            .join()
            .map_err(|_| format!("macOS security {} reader panicked", self.stream_name))
            .and_then(|result| {
                result.map_err(|error| {
                    format!(
                        "Failed to read {} from macOS security CLI: {error}",
                        self.stream_name
                    )
                })
            })
        {
            eprintln!("{error}");
        }
        true
    }
}

struct RetainedSecurityCleanupBundle {
    child: Box<dyn SecurityChildControl + Send>,
    child_poll_error_logged: bool,
    readers: Vec<RetainedSecurityReader>,
}

impl RetainedSecurityCleanup for RetainedSecurityCleanupBundle {
    fn sweep(&mut self) -> bool {
        match self.child.try_wait() {
            Ok(Some(_)) => {}
            Ok(None) => return false,
            Err(error) => {
                if !self.child_poll_error_logged {
                    self.child_poll_error_logged = true;
                    eprintln!(
                        "macOS security cleanup quarantine could not poll retained child: {error}"
                    );
                }
                return false;
            }
        }

        let mut pending_readers = Vec::with_capacity(self.readers.len());
        for mut reader in self.readers.drain(..) {
            if !reader.sweep() {
                pending_readers.push(reader);
            }
        }
        self.readers = pending_readers;
        self.readers.is_empty()
    }
}

enum SecurityCleanupManagerMessage {
    Retain {
        cleanup: Box<dyn RetainedSecurityCleanup>,
        acknowledged: std::sync::mpsc::SyncSender<bool>,
    },
}

struct SecurityCleanupManager {
    sender: std::sync::mpsc::Sender<SecurityCleanupManagerMessage>,
}

impl SecurityCleanupManager {
    fn shared() -> &'static Self {
        static MANAGER: std::sync::OnceLock<SecurityCleanupManager> = std::sync::OnceLock::new();
        MANAGER.get_or_init(|| {
            let (sender, receiver) = std::sync::mpsc::channel();
            thread::Builder::new()
                .name("security-cleanup-quarantine".to_string())
                .spawn(move || {
                    let mut retained = Vec::<Box<dyn RetainedSecurityCleanup>>::new();
                    loop {
                        match receiver.recv_timeout(SECURITY_CLEANUP_SWEEP_INTERVAL) {
                            Ok(SecurityCleanupManagerMessage::Retain {
                                cleanup,
                                acknowledged,
                            }) => {
                                retained.retain_mut(|cleanup| !cleanup.sweep());
                                if retained.len() < MAX_RETAINED_SECURITY_CLEANUPS {
                                    retained.push(cleanup);
                                    let _ = acknowledged.send(true);
                                } else {
                                    eprintln!(
                                        "macOS security cleanup quarantine hit its {} item cap; \
                                         dropping a new retained cleanup bundle because the child \
                                         could not be reaped within budget",
                                        MAX_RETAINED_SECURITY_CLEANUPS
                                    );
                                    let _ = acknowledged.send(false);
                                }
                            }
                            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
                        }
                        retained.retain_mut(|cleanup| !cleanup.sweep());
                    }
                })
                .expect("security cleanup quarantine thread should start");
            Self { sender }
        })
    }

    fn retain(&self, cleanup: Box<dyn RetainedSecurityCleanup>) -> bool {
        let (ack_sender, ack_receiver) = std::sync::mpsc::sync_channel(1);
        if self
            .sender
            .send(SecurityCleanupManagerMessage::Retain {
                cleanup,
                acknowledged: ack_sender,
            })
            .is_err()
        {
            eprintln!(
                "macOS security cleanup quarantine thread stopped before it could retain a \
                 cleanup bundle"
            );
            return false;
        }
        ack_receiver.recv().unwrap_or(false)
    }
}

fn retain_unreapable_security_cleanup<C>(child: C, readers: Vec<RetainedSecurityReader>) -> bool
where
    C: SecurityChildControl + Send + 'static,
{
    SecurityCleanupManager::shared().retain(Box::new(RetainedSecurityCleanupBundle {
        child: Box::new(child),
        child_poll_error_logged: false,
        readers,
    }))
}

fn reap_security_child<C>(
    mut child: C,
    events: std::sync::mpsc::Sender<SecurityChildCleanupEvent>,
    retry_timeout: Duration,
    retained_readers: std::sync::Arc<std::sync::Mutex<Option<Vec<RetainedSecurityReader>>>>,
) where
    C: SecurityChildControl + Send + 'static,
{
    let mut termination_requested = false;
    let mut kill_error_reported = false;
    let mut poll_error_reported = false;
    let retry_deadline = Instant::now() + retry_timeout;

    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let _ = events.send(SecurityChildCleanupEvent::Reaped);
                return;
            }
            Ok(None) => {}
            Err(error) => {
                if !poll_error_reported {
                    let _ = events.send(SecurityChildCleanupEvent::PollFailed(error.to_string()));
                    poll_error_reported = true;
                }
            }
        }

        if !termination_requested {
            match child.kill() {
                Ok(()) => termination_requested = true,
                Err(error) => {
                    if !kill_error_reported {
                        let _ =
                            events.send(SecurityChildCleanupEvent::KillFailed(error.to_string()));
                        kill_error_reported = true;
                    }
                }
            }
        }

        let remaining = retry_deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            let readers = retained_readers
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take()
                .unwrap_or_default();
            let retained = retain_unreapable_security_cleanup(child, readers);
            eprintln!(
                "macOS security child cleanup exhausted its {} ms retry budget; {}",
                retry_timeout.as_millis(),
                if retained {
                    "the child entered the bounded cleanup quarantine so late exit can still be reaped"
                } else {
                    "the bounded cleanup quarantine was full, so this child could not be retained"
                }
            );
            let _ = events.send(SecurityChildCleanupEvent::RetryBudgetExhausted { retained });
            return;
        }
        thread::sleep(SECURITY_CHILD_CLEANUP_POLL_INTERVAL.min(remaining));
    }
}

struct SecurityChildReaper<C> {
    child_sender: std::sync::mpsc::SyncSender<C>,
    event_receiver: std::sync::mpsc::Receiver<SecurityChildCleanupEvent>,
    thread: thread::JoinHandle<()>,
    retry_timeout: Duration,
    retained_readers: std::sync::Arc<std::sync::Mutex<Option<Vec<RetainedSecurityReader>>>>,
}

impl<C> SecurityChildReaper<C>
where
    C: SecurityChildControl + Send + 'static,
{
    fn start() -> Result<Self, String> {
        Self::start_with_retry_timeout(SECURITY_CHILD_CLEANUP_RETRY_TIMEOUT)
    }

    fn start_with_retry_timeout(retry_timeout: Duration) -> Result<Self, String> {
        let (child_sender, child_receiver) = std::sync::mpsc::sync_channel(1);
        let (event_sender, event_receiver) = std::sync::mpsc::channel();
        let retained_readers = std::sync::Arc::new(std::sync::Mutex::new(None));
        let thread_readers = std::sync::Arc::clone(&retained_readers);
        let thread = thread::Builder::new()
            .name("security-child-reaper".to_string())
            .spawn(move || {
                if let Ok(child) = child_receiver.recv() {
                    reap_security_child(child, event_sender, retry_timeout, thread_readers);
                }
            })
            .map_err(|error| format!("Failed to start macOS security child reaper: {error}"))?;

        Ok(Self {
            child_sender,
            event_receiver,
            thread,
            retry_timeout,
            retained_readers,
        })
    }

    fn attach_readers(&self, readers: Vec<RetainedSecurityReader>) {
        *self
            .retained_readers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(readers);
    }

    fn dismiss(self) -> Vec<RetainedSecurityReader> {
        let Self {
            child_sender,
            event_receiver: _,
            thread,
            retry_timeout: _,
            retained_readers,
        } = self;
        drop(child_sender);
        let _ = thread.join();
        let readers = retained_readers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
            .unwrap_or_default();
        readers
    }

    fn terminate(self, child: C) -> Result<(), String> {
        self.terminate_with_timeout(child, SECURITY_CHILD_CLEANUP_TIMEOUT)
    }

    fn terminate_with_timeout(self, child: C, timeout: Duration) -> Result<(), String> {
        let Self {
            child_sender,
            event_receiver,
            thread,
            retry_timeout,
            retained_readers,
        } = self;

        // The receiver cannot disconnect here: its thread blocks on recv while
        // this sender remains alive. Once sent, that thread owns the Child until
        // try_wait confirms it has been reaped or the bounded retry policy hands
        // it to the shared cleanup quarantine.
        child_sender
            .send(child)
            .expect("security child reaper must remain available until it receives the child");
        drop(child_sender);
        drop(thread); // Detach so an unkillable child cannot block this caller.

        let deadline = Instant::now() + timeout;
        let mut cleanup_errors = Vec::new();
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match event_receiver.recv_timeout(remaining) {
                Ok(SecurityChildCleanupEvent::KillFailed(error)) => {
                    cleanup_errors.push(format!("kill failed: {error}"));
                }
                Ok(SecurityChildCleanupEvent::PollFailed(error)) => {
                    cleanup_errors.push(format!("try_wait failed: {error}"));
                }
                Ok(SecurityChildCleanupEvent::Reaped) => {
                    let reader_errors = join_security_readers(
                        retained_readers
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner)
                            .take()
                            .unwrap_or_default(),
                    );
                    cleanup_errors.extend(reader_errors);
                    if cleanup_errors.is_empty() {
                        return Ok(());
                    }
                    return Err(format!(
                        "macOS security child was reaped after cleanup errors: {}",
                        cleanup_errors.join("; ")
                    ));
                }
                Ok(SecurityChildCleanupEvent::RetryBudgetExhausted { retained }) => {
                    let details = if cleanup_errors.is_empty() {
                        String::new()
                    } else {
                        format!(" ({})", cleanup_errors.join("; "))
                    };
                    return Err(format!(
                        "macOS security child cleanup exhausted its {} ms retry budget{details}; \
                         {}",
                        retry_timeout.as_millis(),
                        if retained {
                            "the child could not be reaped, so the bounded cleanup quarantine retained its handle for later reaping"
                        } else {
                            "the child could not be reaped, and the bounded cleanup quarantine was already full"
                        }
                    ));
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    let details = if cleanup_errors.is_empty() {
                        String::new()
                    } else {
                        format!(" ({})", cleanup_errors.join("; "))
                    };
                    return Err(format!(
                        "macOS security child cleanup was not confirmed within {} ms{details}; \
                         the dedicated reaper continues kill/try_wait retries for at most {} ms \
                         total before handing the child and any output readers to the bounded \
                         cleanup quarantine",
                        timeout.as_millis(),
                        retry_timeout.as_millis()
                    ));
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(
                        "macOS security child reaper stopped before confirming the child was reaped"
                            .to_string(),
                    );
                }
            }
        }
    }
}

fn join_security_readers(readers: Vec<RetainedSecurityReader>) -> Vec<String> {
    readers
        .into_iter()
        .filter_map(|reader| reader.finish().err())
        .collect()
}

fn cleanup_security_child_error<C>(
    error: String,
    reaper: SecurityChildReaper<C>,
    child: C,
) -> String
where
    C: SecurityChildControl + Send + 'static,
{
    match reaper.terminate(child) {
        Ok(()) => error,
        Err(cleanup_error) => format!("{error}; {cleanup_error}"),
    }
}

fn spawn_security_output_reader<R>(
    stream_name: &str,
    mut stream: R,
) -> io::Result<thread::JoinHandle<io::Result<Vec<u8>>>>
where
    R: Read + Send + 'static,
{
    thread::Builder::new()
        .name(format!("security-{stream_name}-reader"))
        .spawn(move || {
            let mut bytes = Vec::new();
            stream.read_to_end(&mut bytes)?;
            Ok(bytes)
        })
}

fn wait_for_security_child_output_with<W>(
    mut child: std::process::Child,
    reaper: SecurityChildReaper<std::process::Child>,
    wait: W,
) -> Result<Output, String>
where
    W: FnOnce(&mut std::process::Child) -> io::Result<std::process::ExitStatus>,
{
    let Some(stdout) = child.stdout.take() else {
        return Err(cleanup_security_child_error(
            "Failed to capture stdout from macOS security CLI".to_string(),
            reaper,
            child,
        ));
    };
    let stdout_reader = match spawn_security_output_reader("stdout", stdout) {
        Ok(reader) => reader,
        Err(error) => {
            return Err(cleanup_security_child_error(
                format!("Failed to read stdout from macOS security CLI: {error}"),
                reaper,
                child,
            ));
        }
    };

    let Some(stderr) = child.stderr.take() else {
        return Err(cleanup_security_child_error(
            "Failed to capture stderr from macOS security CLI".to_string(),
            reaper,
            child,
        ));
    };
    let stderr_reader = match spawn_security_output_reader("stderr", stderr) {
        Ok(reader) => reader,
        Err(error) => {
            return Err(cleanup_security_child_error(
                format!("Failed to read stderr from macOS security CLI: {error}"),
                reaper,
                child,
            ));
        }
    };
    reaper.attach_readers(vec![
        RetainedSecurityReader::new("stdout", stdout_reader),
        RetainedSecurityReader::new("stderr", stderr_reader),
    ]);

    let status = match wait(&mut child) {
        Ok(status) => status,
        Err(error) => {
            return Err(cleanup_security_child_error(
                format!("Failed to wait for macOS security CLI: {error}"),
                reaper,
                child,
            ));
        }
    };
    let mut readers = reaper.dismiss();
    let stderr = readers
        .pop()
        .expect("stderr reader should remain attached")
        .finish()?;
    let stdout = readers
        .pop()
        .expect("stdout reader should remain attached")
        .finish()?;

    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn run_security_command_with_secret<F>(
    args: &[&str],
    value: &str,
    before_write: F,
) -> Result<Output, String>
where
    F: FnOnce(u32) -> Result<(), String>,
{
    // Start the reaper before the child so every post-spawn failure can transfer
    // ownership instead of dropping a live Child handle.
    let reaper = SecurityChildReaper::<std::process::Child>::start()?;
    let mut child = match Command::new("/usr/bin/security")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => {
            reaper.dismiss();
            return Err(format!("Failed to run macOS security CLI: {error}"));
        }
    };

    if let Err(error) = before_write(child.id()) {
        return Err(cleanup_security_child_error(error, reaper, child));
    }

    let Some(mut stdin) = child.stdin.take() else {
        return Err(cleanup_security_child_error(
            "Failed to open stdin for macOS security CLI".to_string(),
            reaper,
            child,
        ));
    };

    // The interactive form asks for the password and then confirmation.
    if let Err(error) = stdin
        .write_all(value.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.write_all(value.as_bytes()))
        .and_then(|_| stdin.write_all(b"\n"))
    {
        drop(stdin);
        return Err(cleanup_security_child_error(
            format!("Failed to send secret to macOS security CLI: {error}"),
            reaper,
            child,
        ));
    }
    drop(stdin);

    wait_for_security_child_output_with(child, reaper, std::process::Child::wait)
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
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    };

    unsafe extern "C" {
        #[link_name = "kill"]
        fn signal_process(pid: std::ffi::c_int, signal: std::ffi::c_int) -> std::ffi::c_int;
    }

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

    #[test]
    fn wait_failure_kills_and_reaps_the_live_child() {
        let reaper = SecurityChildReaper::<std::process::Child>::start()
            .expect("the child reaper should start");
        let child = Command::new("/bin/sleep")
            .arg("30")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("the lifecycle test child should start");
        let pid = child.id();

        let error = wait_for_security_child_output_with(child, reaper, |_| {
            Err(io::Error::other("synthetic wait failure"))
        })
        .expect_err("the injected wait failure should be returned");

        assert!(error.contains("synthetic wait failure"));
        let signal_result = unsafe { signal_process(pid as std::ffi::c_int, 0) };
        let signal_error = io::Error::last_os_error();
        assert_eq!(signal_result, -1, "the failed-wait child is still live");
        assert_eq!(
            signal_error.raw_os_error(),
            Some(3), // ESRCH on the Unix targets supported by this test module.
            "the failed-wait child should have been killed and reaped"
        );
    }

    struct TemporarilyUnkillableChild {
        release: Arc<AtomicBool>,
        dropped: std::sync::mpsc::SyncSender<bool>,
        fallback_exit: Instant,
    }

    impl SecurityChildControl for TemporarilyUnkillableChild {
        fn kill(&mut self) -> io::Result<()> {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "synthetic kill refusal",
            ))
        }

        fn try_wait(&mut self) -> io::Result<Option<std::process::ExitStatus>> {
            if self.release.load(Ordering::SeqCst) || Instant::now() >= self.fallback_exit {
                Ok(Some(ExitStatus::from_raw(0)))
            } else {
                Ok(None)
            }
        }
    }

    impl Drop for TemporarilyUnkillableChild {
        fn drop(&mut self) {
            let _ = self.dropped.send(self.release.load(Ordering::SeqCst));
        }
    }

    #[test]
    fn cleanup_is_bounded_when_the_child_cannot_be_killed() {
        let reaper = SecurityChildReaper::<TemporarilyUnkillableChild>::start()
            .expect("the child reaper should start");
        let release = Arc::new(AtomicBool::new(false));
        let (dropped_sender, dropped_receiver) = std::sync::mpsc::sync_channel(1);
        let child = TemporarilyUnkillableChild {
            release: Arc::clone(&release),
            dropped: dropped_sender,
            fallback_exit: Instant::now() + Duration::from_secs(2),
        };
        let (result_sender, result_receiver) = std::sync::mpsc::sync_channel(1);

        let cleanup = thread::spawn(move || {
            let result = reaper.terminate_with_timeout(child, Duration::from_millis(50));
            let _ = result_sender.send(result);
        });
        let result = result_receiver
            .recv_timeout(Duration::from_millis(500))
            .expect("cleanup should return at its bound instead of waiting for child exit");
        let error = result.expect_err("an unconfirmed cleanup must fail closed");
        assert!(error.contains("not confirmed within 50 ms"));
        assert!(error.contains("kill failed: synthetic kill refusal"));
        assert!(error.contains("bounded cleanup quarantine"));

        assert!(
            matches!(
                dropped_receiver.try_recv(),
                Err(std::sync::mpsc::TryRecvError::Empty)
            ),
            "the child handle must still be retained before release"
        );
        release.store(true, Ordering::SeqCst);
        let released_before_drop = dropped_receiver
            .recv_timeout(Duration::from_millis(500))
            .expect("the retained child should be reaped and released once it exits");
        assert!(
            released_before_drop,
            "the retained child must not be dropped before release"
        );
        cleanup
            .join()
            .expect("the bounded cleanup caller should exit");
    }

    struct PermanentlyUnkillableChild {
        kill_attempts: Arc<AtomicUsize>,
        dropped: std::sync::mpsc::SyncSender<()>,
    }

    impl SecurityChildControl for PermanentlyUnkillableChild {
        fn kill(&mut self) -> io::Result<()> {
            self.kill_attempts.fetch_add(1, Ordering::SeqCst);
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "synthetic permanent kill refusal",
            ))
        }

        fn try_wait(&mut self) -> io::Result<Option<std::process::ExitStatus>> {
            Ok(None)
        }
    }

    impl Drop for PermanentlyUnkillableChild {
        fn drop(&mut self) {
            let _ = self.dropped.send(());
        }
    }

    #[test]
    fn cleanup_stops_retrying_at_its_budget_without_dropping_the_child() {
        let reaper = SecurityChildReaper::<PermanentlyUnkillableChild>::start_with_retry_timeout(
            Duration::from_millis(50),
        )
        .expect("the child reaper should start");
        let kill_attempts = Arc::new(AtomicUsize::new(0));
        let (dropped_sender, dropped_receiver) = std::sync::mpsc::sync_channel(1);
        let child = PermanentlyUnkillableChild {
            kill_attempts: Arc::clone(&kill_attempts),
            dropped: dropped_sender,
        };

        let error = reaper
            .terminate_with_timeout(child, Duration::from_millis(500))
            .expect_err("an unkillable child must exhaust the retry budget");
        assert!(error.contains("exhausted its 50 ms retry budget"));
        assert!(error.contains("kill failed: synthetic permanent kill refusal"));
        assert!(error.contains("bounded cleanup quarantine retained its handle"));

        let attempts_at_bound = kill_attempts.load(Ordering::SeqCst);
        assert!(
            attempts_at_bound > 0,
            "cleanup must attempt to kill the child"
        );
        thread::sleep(Duration::from_millis(50));
        assert_eq!(
            kill_attempts.load(Ordering::SeqCst),
            attempts_at_bound,
            "cleanup must stop retrying after the retry budget"
        );
        assert!(
            matches!(
                dropped_receiver.try_recv(),
                Err(std::sync::mpsc::TryRecvError::Empty)
            ),
            "the bounded cleanup quarantine must retain the unreaped child handle"
        );
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
