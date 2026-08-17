//! #151 slice 1: durable trust-on-first-use store for native SSH host keys.
//!
//! The defect this closes: `connect_native_session` only verified a host key
//! when one was already pinned. A host configured `allowUnknown` therefore
//! authenticated with no host-key check at all — and because the first-seen key
//! was never recorded, it stayed in that state on every connect, forever. Not
//! "unverified once", which is what TOFU means, but unverified always.
//!
//! So the pin has to persist. It deliberately does NOT live under the per-session
//! temp roots in `native_transport` (those are `remove_dir_all`'d on teardown);
//! a pin written somewhere ephemeral presents as verification while providing
//! none, which is worse than not verifying at all.
//!
//! Scope: the direct ssh2 path verifies against this store (slice 1), and the
//! OpenSSH-driven jump path points `UserKnownHostsFile` at the same file
//! (slice 2). So OpenSSH is a second writer to it, by design.
//!
//! Concurrency (slice 3). Three writers can touch this file: this process,
//! another instance of the app, and `ssh` itself. The process-level mutex only
//! covers the first. A sidecar `known_hosts.lock` under `File::lock` covers the
//! second — cooperating app instances serialise load-decide-write through it.
//!
//! Nothing can make `ssh` take that lock, so the third is handled structurally
//! instead: writes are APPEND-ONLY. The store used to be rewritten wholesale
//! from a HashMap via temp+rename, which does not merely race an `ssh` append —
//! it replaces the file and destroys it. Never rewriting bytes we did not author
//! means a completed `ssh` pin cannot be lost that way.
//!
//! What is still racy, stated plainly: two writers meeting the SAME host for the
//! first time can both decide "unknown" and append. Closing that needs the
//! trust decision moved into Rust with `StrictHostKeyChecking=yes`, which is a
//! larger redesign than this.
//!
//! The cost of append-only is losing rename's crash atomicity: a torn write
//! leaves a malformed store, which `load` refuses. That is an availability
//! failure rather than a silent re-pin, which is the right way round — but it is
//! why the malformed-store error names the file and the recovery.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

/// A durable `host -> (algorithm, base64 key)` map in OpenSSH `known_hosts`
/// shape: `hostname algorithm base64-key`, one record per line.
pub(crate) struct NativeHostKeyStore {
    path: PathBuf,
    /// Sidecar, not the trust file itself: `ssh` rewrites `known_hosts` on some
    /// paths, and a lock is only meaningful if the inode holding it is stable.
    lock_path: PathBuf,
    guard: Mutex<()>,
}

/// Outcome of checking a presented key against the store.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum HostKeyVerdict {
    /// Nothing was pinned for this host; the presented key has been recorded.
    Pinned,
    /// The presented key matches what was pinned.
    Matches,
    /// A different key is pinned. The caller MUST NOT authenticate.
    Mismatch { pinned: String },
}

pub(crate) type SharedNativeHostKeyStore = Arc<NativeHostKeyStore>;

/// #151 slice 2: the OpenSSH-driven jump path needs the same durable location,
/// but only as a constant path — it hands verification to `ssh` via a config
/// file rather than checking keys itself. Threading the store through the five
/// jump/mosh helper signatures and their 19 call sites purely to carry that
/// constant would be churn, so the resolved path is published once at setup.
static DURABLE_KNOWN_HOSTS: OnceLock<PathBuf> = OnceLock::new();

/// Publish the durable store path. Called once from Tauri setup; later calls are
/// ignored, so a test or a second init cannot repoint trust state at runtime.
pub(crate) fn publish_durable_known_hosts_path(path: PathBuf) {
    let _ = DURABLE_KNOWN_HOSTS.set(path);
}

/// The durable `known_hosts` path.
///
/// #151 slice 3: this is an error rather than an `Option` with a fallback. It
/// used to fall back to the per-session file, which is the very thing that made
/// unpinned hops first-use-forever — so the fallback quietly reinstated the
/// defect slice 2 fixed, in exactly the case where something had already gone
/// wrong. Refusing is the fail-closed direction, and it guards the consequence
/// no matter where publication moves to.
pub(crate) fn durable_known_hosts_path() -> Result<&'static PathBuf, String> {
    DURABLE_KNOWN_HOSTS.get().ok_or_else(|| {
        "durable SSH host-key state was never initialised; refusing to connect".to_string()
    })
}


impl NativeHostKeyStore {
    /// `dir` is the app-data directory; the store lives in `<dir>/ssh/known_hosts`.
    /// Resolved through Tauri at setup rather than hard-coded, so it follows the
    /// bundle identifier.
    pub(crate) fn new(dir: &Path) -> Result<Self, String> {
        let ssh_dir = dir.join("ssh");
        fs::create_dir_all(&ssh_dir)
            .map_err(|error| format!("could not create SSH host-key directory: {error}"))?;
        #[cfg(unix)]
        {
            // 0700: the pinned keys are not secret, but the directory is trust
            // state — another local user must not be able to add a pin.
            let mut perms = fs::metadata(&ssh_dir)
                .map_err(|error| format!("could not stat SSH host-key directory: {error}"))?
                .permissions();
            perms.set_mode(0o700);
            fs::set_permissions(&ssh_dir, perms)
                .map_err(|error| format!("could not secure SSH host-key directory: {error}"))?;
        }
        Ok(Self {
            path: ssh_dir.join("known_hosts"),
            lock_path: ssh_dir.join("known_hosts.lock"),
            guard: Mutex::new(()),
        })
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// The app-data directory this store was built from, so a test can rebuild
    /// the store at the same location and prove the pin really persisted.
    #[cfg(test)]
    pub(crate) fn root(&self) -> &Path {
        self.path
            .parent()
            .and_then(|ssh| ssh.parent())
            .expect("store path always has <root>/ssh/known_hosts shape")
    }

    /// Check `presented` for `host_pattern`, pinning it when nothing is recorded.
    ///
    /// Fails closed: an unreadable or malformed store, or a poisoned lock, is an
    /// error rather than an empty map. Silently treating a damaged store as
    /// "nothing pinned" would re-pin whatever answered the socket, which is the
    /// exact hole this closes.
    pub(crate) fn verify_or_pin(
        &self,
        host_pattern: &str,
        algorithm: &str,
        presented: &str,
    ) -> Result<HostKeyVerdict, String> {
        if algorithm.trim().is_empty() || presented.trim().is_empty() {
            return Err("SSH server presented an unusable host key".to_string());
        }
        // #151 slice 3: a poisoned mutex used to fail every later connection
        // until restart. This guard protects `()`, not an in-memory copy of the
        // trust state — a panic cannot leave it half-mutated, and every verdict
        // below is still re-derived from the file under the cross-process lock.
        // So poisoning carries no security signal here, and refusing forever was
        // a self-inflicted outage rather than a safety measure.
        let _guard = match self.guard.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!(
                    "[termsnip] SSH host-key store mutex was poisoned by an earlier panic; \
                     re-reading trust state from disk"
                );
                let guard = poisoned.into_inner();
                self.guard.clear_poison();
                guard
            }
        };

        // Held across load-decide-append so a second app instance cannot
        // interleave. `ssh` does not take this lock and cannot be made to —
        // see the module header for what that leaves open.
        let _file_lock = self.lock_across_processes()?;

        let records = self.load()?;
        match records.get(host_pattern) {
            Some((_, pinned)) if pinned == presented => Ok(HostKeyVerdict::Matches),
            Some((_, pinned)) => Ok(HostKeyVerdict::Mismatch {
                pinned: pinned.clone(),
            }),
            None => {
                // Written BEFORE the caller authenticates, so a crash between
                // pinning and auth leaves the key pinned rather than unpinned.
                self.append_pin(host_pattern, algorithm, presented)?;
                Ok(HostKeyVerdict::Pinned)
            }
        }
    }

    /// Take the cross-process lock, returning the handle whose drop releases it.
    ///
    /// Blocking rather than `try_lock`: the critical section is a small bounded
    /// read and append, so waiting is correct — turning contention into a failed
    /// connection would be a worse trade than a few milliseconds of delay.
    fn lock_across_processes(&self) -> Result<fs::File, String> {
        if let Ok(metadata) = fs::symlink_metadata(&self.lock_path) {
            if !metadata.is_file() {
                return Err(
                    "the SSH host-key lock is not a regular file; refusing to authenticate"
                        .to_string(),
                );
            }
        }
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        options.mode(0o600);
        let file = options
            .open(&self.lock_path)
            .map_err(|error| format!("could not open the SSH host-key lock: {error}"))?;
        file.lock()
            .map_err(|error| format!("could not lock the SSH host-key store: {error}"))?;
        Ok(file)
    }

    fn load(&self) -> Result<HashMap<String, (String, String)>, String> {
        let metadata = match fs::symlink_metadata(&self.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(HashMap::new())
            }
            Err(error) => return Err(format!("could not read the SSH host-key store: {error}")),
        };
        if !metadata.is_file() {
            // A symlink or directory here means something is manipulating trust
            // state. Refuse rather than follow it.
            return Err(
                "the SSH host-key store is not a regular file; refusing to authenticate".to_string(),
            );
        }

        let contents = fs::read_to_string(&self.path)
            .map_err(|error| format!("could not read the SSH host-key store: {error}"))?;
        let mut records = HashMap::new();
        for (index, line) in contents.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let mut fields = line.split_whitespace();
            match (fields.next(), fields.next(), fields.next()) {
                (Some(host), Some(algorithm), Some(key)) => {
                    records.insert(
                        host.to_string(),
                        (algorithm.to_string(), key.to_string()),
                    );
                }
                _ => {
                    return Err(format!(
                        "the SSH host-key store at {} is malformed at line {}; refusing to \
                         authenticate. Remove that line, or delete the file to re-pin from \
                         scratch, then reconnect.",
                        self.path.display(),
                        index + 1
                    ))
                }
            }
        }
        Ok(records)
    }

    /// Append one record. Never rewrites a line it did not author, so a pin that
    /// `ssh` appended to this same file cannot be destroyed by our write —
    /// which the previous whole-file temp+rename did, silently.
    fn append_pin(&self, host: &str, algorithm: &str, key: &str) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "SSH host-key store has no parent directory".to_string())?;

        // Only when the file exists and does not already end in a newline: a
        // previous writer that stopped mid-line must not have our record welded
        // onto the end of theirs.
        let needs_separator = match fs::read(&self.path) {
            Ok(existing) => !existing.is_empty() && !existing.ends_with(b"\n"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => return Err(format!("could not read the SSH host-key store: {error}")),
        };

        let mut body = String::new();
        if needs_separator {
            body.push('\n');
        }
        body.push_str(&format!("{host} {algorithm} {key}\n"));

        let mut options = fs::OpenOptions::new();
        options.append(true).create(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options
            .open(&self.path)
            .map_err(|error| format!("could not write the SSH host-key store: {error}"))?;

        // Re-check through the OPEN descriptor, not the path: between the
        // regular-file check in load() and here, the path could have been
        // swapped for a symlink pointing somewhere else.
        #[cfg(unix)]
        {
            let opened = file
                .metadata()
                .map_err(|error| format!("could not stat the SSH host-key store: {error}"))?;
            if !opened.is_file() {
                return Err(
                    "the SSH host-key store is not a regular file; refusing to authenticate"
                        .to_string(),
                );
            }
        }

        // One write for the whole record. append(true) puts each write at EOF
        // even with concurrent appenders, so a single call is the closest thing
        // to an atomic record that this gives us; a short write would leave a
        // torn line, so it is an error rather than something to retry into.
        let written = file
            .write(body.as_bytes())
            .map_err(|error| format!("could not write the SSH host-key store: {error}"))?;
        if written != body.len() {
            return Err(format!(
                "the SSH host-key store at {} was only partially written; refusing to authenticate",
                self.path.display()
            ));
        }
        file.sync_all()
            .map_err(|error| format!("could not flush the SSH host-key store: {error}"))?;
        drop(file);

        // Sync the directory so the record is durable, not just the file's data.
        if let Ok(dir) = fs::File::open(parent) {
            let _ = dir.sync_all();
        }
        Ok(())
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    use std::process;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Matches the pid+nanos convention the native_transport tests already use,
    /// rather than pulling in a temp-dir crate for this alone.
    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new(label: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos();
            let root = std::env::temp_dir()
                .join(format!("tw-host-keys-{label}-{}-{nanos}", process::id()));
            fs::create_dir_all(&root).expect("test root should be created");
            Self(root)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn temp_store(label: &str) -> (TempRoot, NativeHostKeyStore) {
        let dir = TempRoot::new(label);
        let store = NativeHostKeyStore::new(dir.path()).expect("store");
        (dir, store)
    }

    /// Non-blank, non-comment records, in file order.
    fn pin_lines(store: &NativeHostKeyStore) -> Vec<String> {
        fs::read_to_string(store.path())
            .unwrap_or_default()
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(str::to_string)
            .collect()
    }

    /// #151 slice 3. Two SEPARATE stores over one directory — separate stores so
    /// they hold separate mutexes, which is what makes this exercise the
    /// cross-process `File::lock` rather than the in-process one. Both meet the
    /// same host at once; exactly one pin may result.
    #[test]
    fn concurrent_stores_pin_the_same_host_exactly_once() {
        let dir = TempRoot::new("concurrent-same-host");
        let one = NativeHostKeyStore::new(dir.path()).expect("store");
        let two = NativeHostKeyStore::new(dir.path()).expect("store");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));

        let gate = barrier.clone();
        let first = std::thread::spawn(move || {
            gate.wait();
            one.verify_or_pin("host.example", "ssh-ed25519", "AAAAKEY")
        });
        let gate = barrier.clone();
        let second = std::thread::spawn(move || {
            gate.wait();
            two.verify_or_pin("host.example", "ssh-ed25519", "AAAAKEY")
        });

        let mut verdicts = vec![
            first.join().expect("thread").expect("verdict"),
            second.join().expect("thread").expect("verdict"),
        ];
        verdicts.sort_by_key(|verdict| format!("{verdict:?}"));
        assert_eq!(
            verdicts,
            vec![HostKeyVerdict::Matches, HostKeyVerdict::Pinned],
            "one writer pins, the other must observe that pin — not pin again"
        );

        let reader = NativeHostKeyStore::new(dir.path()).expect("store");
        assert_eq!(
            pin_lines(&reader),
            vec!["host.example ssh-ed25519 AAAAKEY".to_string()]
        );
    }

    /// The same arrangement with different hosts: neither may lose the other's
    /// record. This is what the old whole-file rewrite could not guarantee.
    #[test]
    fn concurrent_stores_preserve_each_others_hosts() {
        let dir = TempRoot::new("concurrent-distinct-hosts");
        let one = NativeHostKeyStore::new(dir.path()).expect("store");
        let two = NativeHostKeyStore::new(dir.path()).expect("store");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));

        let gate = barrier.clone();
        let first = std::thread::spawn(move || {
            gate.wait();
            one.verify_or_pin("alpha.example", "ssh-ed25519", "AAAAALPHA")
        });
        let gate = barrier.clone();
        let second = std::thread::spawn(move || {
            gate.wait();
            two.verify_or_pin("beta.example", "ssh-rsa", "AAAABETA")
        });
        assert_eq!(first.join().expect("thread").expect("verdict"), HostKeyVerdict::Pinned);
        assert_eq!(second.join().expect("thread").expect("verdict"), HostKeyVerdict::Pinned);

        let reader = NativeHostKeyStore::new(dir.path()).expect("store");
        let mut lines = pin_lines(&reader);
        lines.sort();
        assert_eq!(
            lines,
            vec![
                "alpha.example ssh-ed25519 AAAAALPHA".to_string(),
                "beta.example ssh-rsa AAAABETA".to_string(),
            ]
        );
    }

    /// The race this slice exists for. `ssh` shares this file and does not take
    /// our lock, so it can append between our read and our write. Under the old
    /// whole-file temp+rename that appended pin was destroyed; append-only keeps
    /// it. Modelled deterministically rather than by racing a real ssh.
    #[test]
    fn an_external_append_survives_our_next_pin() {
        let (dir, store) = temp_store("external-append");
        store
            .verify_or_pin("ours.example", "ssh-ed25519", "AAAAOURS")
            .expect("first pin");

        // What `ssh` writes with accept-new: a plain record, appended.
        let mut existing = fs::read_to_string(store.path()).expect("read");
        existing.push_str("theirs.example ssh-ed25519 AAAATHEIRS\n");
        fs::write(store.path(), existing).expect("external append");

        store
            .verify_or_pin("later.example", "ssh-ed25519", "AAAALATER")
            .expect("later pin");

        let mut lines = pin_lines(&store);
        lines.sort();
        assert_eq!(
            lines,
            vec![
                "later.example ssh-ed25519 AAAALATER".to_string(),
                "ours.example ssh-ed25519 AAAAOURS".to_string(),
                "theirs.example ssh-ed25519 AAAATHEIRS".to_string(),
            ],
            "a pin ssh appended must survive our later write"
        );
        drop(dir);
    }

    /// A record appended by `ssh` must also be honoured as a pin, not just
    /// preserved as bytes — otherwise the shared file is only half shared.
    #[test]
    fn an_externally_pinned_host_is_verified_against() {
        let (dir, store) = temp_store("external-pin-honoured");
        fs::write(store.path(), "theirs.example ssh-ed25519 AAAATHEIRS\n").expect("seed");

        assert_eq!(
            store
                .verify_or_pin("theirs.example", "ssh-ed25519", "AAAATHEIRS")
                .expect("verdict"),
            HostKeyVerdict::Matches
        );
        assert!(matches!(
            store.verify_or_pin("theirs.example", "ssh-ed25519", "DIFFERENT"),
            Ok(HostKeyVerdict::Mismatch { .. })
        ));
        drop(dir);
    }

    /// #151 slice 3: a panic elsewhere used to poison the mutex and fail every
    /// later connection until restart. The guard protects `()`, so nothing can
    /// be half-mutated and refusing forever bought no safety.
    #[test]
    fn a_poisoned_mutex_does_not_disable_the_store() {
        let (dir, store) = temp_store("poisoned-mutex");
        let store = std::sync::Arc::new(store);

        let panicking = {
            let store = store.clone();
            std::thread::spawn(move || {
                let _held = store.guard.lock().expect("lock");
                panic!("poison the guard");
            })
        };
        assert!(panicking.join().is_err(), "the thread must actually panic");
        assert!(store.guard.is_poisoned());

        assert_eq!(
            store
                .verify_or_pin("host.example", "ssh-ed25519", "AAAAKEY")
                .expect("a poisoned guard must not block a verdict"),
            HostKeyVerdict::Pinned
        );
        assert!(!store.guard.is_poisoned(), "the poison should be cleared");
        drop(dir);
    }

    /// A torn line cannot be silently ignored, and the refusal has to tell the
    /// user how to get out of it — a fail-closed store with no stated recovery
    /// is a dead end.
    #[test]
    fn a_malformed_store_names_the_file_and_the_recovery() {
        let (dir, store) = temp_store("malformed-recovery");
        fs::write(store.path(), "host.example ssh-ed25519\n").expect("seed a torn line");

        let error = store
            .verify_or_pin("other.example", "ssh-ed25519", "AAAAKEY")
            .expect_err("a malformed store must refuse");
        assert!(error.contains(&store.path().display().to_string()), "{error}");
        assert!(error.contains("delete the file"), "{error}");
        drop(dir);
    }

    /// Appending after a writer that stopped mid-line must not weld our record
    /// onto the end of theirs and turn one torn line into one plausible-looking
    /// wrong line.
    #[test]
    fn a_pin_after_an_unterminated_line_starts_on_its_own_line() {
        let (dir, store) = temp_store("unterminated");
        // Well-formed but missing its trailing newline.
        fs::write(store.path(), "theirs.example ssh-ed25519 AAAATHEIRS").expect("seed");

        store
            .verify_or_pin("ours.example", "ssh-ed25519", "AAAAOURS")
            .expect("pin");

        let mut lines = pin_lines(&store);
        lines.sort();
        assert_eq!(
            lines,
            vec![
                "ours.example ssh-ed25519 AAAAOURS".to_string(),
                "theirs.example ssh-ed25519 AAAATHEIRS".to_string(),
            ]
        );
        drop(dir);
    }

    #[test]
    fn pins_on_first_sight_then_matches() {
        let (_dir, store) = temp_store("pin-first");
        assert_eq!(
            store.verify_or_pin("example:2222", "ssh-ed25519", "AAAAKEY1"),
            Ok(HostKeyVerdict::Pinned)
        );
        assert_eq!(
            store.verify_or_pin("example:2222", "ssh-ed25519", "AAAAKEY1"),
            Ok(HostKeyVerdict::Matches)
        );
    }

    #[test]
    fn rejects_a_changed_key_without_overwriting_the_pin() {
        let (_dir, store) = temp_store("changed-key");
        store
            .verify_or_pin("example:2222", "ssh-ed25519", "AAAAKEY1")
            .expect("first pin");
        let verdict = store
            .verify_or_pin("example:2222", "ssh-ed25519", "AAAAKEY2")
            .expect("verdict");
        assert_eq!(
            verdict,
            HostKeyVerdict::Mismatch {
                pinned: "AAAAKEY1".to_string()
            }
        );
        // The original pin must survive a mismatch — otherwise an attacker who
        // can reach the socket could simply overwrite trust.
        assert_eq!(
            store.verify_or_pin("example:2222", "ssh-ed25519", "AAAAKEY1"),
            Ok(HostKeyVerdict::Matches)
        );
    }

    #[test]
    fn survives_reconstruction_from_disk() {
        let (dir, store) = temp_store("reconstruct");
        store
            .verify_or_pin("example:2222", "ssh-ed25519", "AAAAKEY1")
            .expect("pin");
        drop(store);

        // The whole point of the ticket: a pin that does not survive is not TOFU.
        let reopened = NativeHostKeyStore::new(dir.path()).expect("reopen");
        assert_eq!(
            reopened.verify_or_pin("example:2222", "ssh-ed25519", "AAAAKEY1"),
            Ok(HostKeyVerdict::Matches)
        );
    }

    #[test]
    fn keeps_separate_pins_per_host_and_port() {
        let (_dir, store) = temp_store("per-port");
        store
            .verify_or_pin("example", "ssh-ed25519", "AAAAKEY1")
            .expect("pin 22");
        assert_eq!(
            store.verify_or_pin("[example]:2222", "ssh-ed25519", "AAAAKEY2"),
            Ok(HostKeyVerdict::Pinned)
        );
        assert_eq!(
            store.verify_or_pin("example", "ssh-ed25519", "AAAAKEY1"),
            Ok(HostKeyVerdict::Matches)
        );
    }

    #[test]
    fn fails_closed_on_a_malformed_store() {
        let (_dir, store) = temp_store("malformed");
        store
            .verify_or_pin("example", "ssh-ed25519", "AAAAKEY1")
            .expect("pin");
        fs::write(store.path(), "this-line-has-only-one-field\n").expect("corrupt");

        let error = store
            .verify_or_pin("example", "ssh-ed25519", "AAAAKEY1")
            .expect_err("malformed store must not read as empty");
        assert!(error.contains("malformed"), "unexpected error: {error}");
    }

    #[test]
    fn rejects_an_empty_presented_key() {
        let (_dir, store) = temp_store("empty-key");
        assert!(store.verify_or_pin("example", "ssh-ed25519", "").is_err());
        assert!(store.verify_or_pin("example", "", "AAAAKEY1").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn writes_the_store_with_owner_only_permissions() {
        let (_dir, store) = temp_store("perms");
        store
            .verify_or_pin("example", "ssh-ed25519", "AAAAKEY1")
            .expect("pin");
        let mode = fs::metadata(store.path()).expect("stat").permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "store must not be group/world readable");
    }
}
