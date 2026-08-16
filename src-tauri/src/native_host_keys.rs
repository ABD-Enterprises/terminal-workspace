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
//! Scope note: this slice guards the direct ssh2 path. The jump/mosh paths hand
//! host-key checking to OpenSSH against a per-session `known_hosts` file that is
//! deleted afterwards, so they are first-use-forever too — tracked as slice 2 on
//! #151 and not addressed here.
//!
//! Concurrency: a process-level mutex serialises readers and writers, which is
//! sufficient for a single desktop process. Cross-process locking (a second app
//! instance) is slice 3; it needs `std::fs::File` locking and therefore an MSRV
//! bump, which this slice deliberately avoids.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

/// A durable `host -> (algorithm, base64 key)` map in OpenSSH `known_hosts`
/// shape: `hostname algorithm base64-key`, one record per line.
pub(crate) struct NativeHostKeyStore {
    path: PathBuf,
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
            guard: Mutex::new(()),
        })
    }

    #[cfg(test)]
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
        let _lock = self
            .guard
            .lock()
            .map_err(|_| "SSH host-key store lock is unavailable; refusing to authenticate. Restart the application and try again.".to_string())?;

        let mut records = self.load()?;
        match records.get(host_pattern) {
            Some((_, pinned)) if pinned == presented => Ok(HostKeyVerdict::Matches),
            Some((_, pinned)) => Ok(HostKeyVerdict::Mismatch {
                pinned: pinned.clone(),
            }),
            None => {
                records.insert(
                    host_pattern.to_string(),
                    (algorithm.to_string(), presented.to_string()),
                );
                // Written BEFORE the caller authenticates, so a crash between
                // pinning and auth leaves the key pinned rather than unpinned.
                self.store(&records)?;
                Ok(HostKeyVerdict::Pinned)
            }
        }
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
                        "the SSH host-key store is malformed at line {}; refusing to authenticate",
                        index + 1
                    ))
                }
            }
        }
        Ok(records)
    }

    fn store(&self, records: &HashMap<String, (String, String)>) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "SSH host-key store has no parent directory".to_string())?;

        let mut lines: Vec<String> = records
            .iter()
            .map(|(host, (algorithm, key))| format!("{host} {algorithm} {key}"))
            .collect();
        // Sorted so the file is stable across writes and a diff means a real
        // trust change rather than map iteration order.
        lines.sort();
        let body = format!("{}\n", lines.join("\n"));

        // Same-directory temp + rename: a crash mid-write leaves either the old
        // file or the complete new one, never a truncated store that would read
        // as "nothing pinned".
        let temp_path = parent.join("known_hosts.tmp");
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options
            .open(&temp_path)
            .map_err(|error| format!("could not write the SSH host-key store: {error}"))?;
        file.write_all(body.as_bytes())
            .map_err(|error| format!("could not write the SSH host-key store: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("could not flush the SSH host-key store: {error}"))?;
        drop(file);

        fs::rename(&temp_path, &self.path)
            .map_err(|error| format!("could not commit the SSH host-key store: {error}"))?;
        // Sync the directory so the rename itself is durable.
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
