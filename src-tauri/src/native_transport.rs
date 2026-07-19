use super::*;
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;

/// Reject any private-key path the renderer hands us that escapes the user's
/// home directory (or the small set of test/system roots we explicitly allow).
/// Without this guard, a renderer-side XSS could call
/// `terminal_workspace_inspect_private_key` with `/etc/passwd` (or another user's home)
/// to probe file existence and leak metadata via ssh-keygen error messages.
/// See docs/parity-and-hardening-review.md §3.S-6.
/// Lexically collapse `.` and `..` components without touching the filesystem.
/// Used to neutralize `..` traversal in key paths whose leaf (or directory) may
/// not exist yet, so the allowlist check below can't be bypassed via a literal,
/// un-normalized path like `/tmp/../etc/x`.
fn lexically_normalize_absolute(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub(crate) fn validate_user_owned_key_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("Key path is required".to_string());
    }

    if !path.is_absolute() {
        return Err(format!(
            "Key path must be absolute after home-expansion: {}",
            path.display()
        ));
    }

    // Defeat `..` traversal and symlink trickery before the allowlist check.
    // First collapse `.`/`..` lexically so a literal path like `/tmp/../etc/x`
    // cannot escape the allowlist even when its leaf/dir does not exist yet
    // (the generate-new-key flow stages into a not-yet-created directory).
    // Then resolve symlinks when the path actually exists; otherwise fall back
    // to the normalized (already `..`-free) path, which is matched against both
    // the literal and canonical allowlist roots below.
    let normalized = lexically_normalize_absolute(path);
    let canonical = fs::canonicalize(&normalized).unwrap_or(normalized);

    let mut allowed_roots: Vec<PathBuf> = Vec::new();
    let mut push_with_canonical = |path: PathBuf| {
        // Push both the literal path and its canonical form. macOS commonly
        // exposes `/var/folders/...` (literal) and `/private/var/folders/...`
        // (canonical) for the same directory because /var → /private/var is a
        // symlink. When the input path does not yet exist (e.g. we are about
        // to write a new key), canonicalize fails on the leaf, so the literal
        // form is what we end up comparing against.
        let canonical = fs::canonicalize(&path).ok();
        if !allowed_roots.contains(&path) {
            allowed_roots.push(path);
        }
        if let Some(canonical) = canonical {
            if !allowed_roots.contains(&canonical) {
                allowed_roots.push(canonical);
            }
        }
    };

    if let Some(home) = env::var_os("HOME") {
        push_with_canonical(PathBuf::from(home));
    }
    // The user's per-process temp dir. On macOS this is something like
    // /var/folders/<userhash>/T/ (canonicalizes to /private/var/folders/...).
    // Tools that stage a key for import or fixtures that exercise key flows
    // legitimately write here, and the directory is owned by the current user.
    if let Some(tmpdir) = env::var_os("TMPDIR") {
        push_with_canonical(PathBuf::from(tmpdir));
    }
    // System SSH config dirs: read-only system keys are sometimes referenced.
    push_with_canonical(PathBuf::from("/etc/ssh"));
    // Security: world-writable /tmp is intentionally NOT allowlisted — it would
    // let a renderer-XSS read or stage keys that a same-uid attacker can plant.
    // The per-user TMPDIR (0700) pushed above covers legitimate staging and
    // fixture flows.

    if allowed_roots.iter().any(|root| canonical.starts_with(root)) {
        return Ok(());
    }

    Err(format!(
        "Refusing to access private key outside HOME or /etc/ssh: {}",
        canonical.display()
    ))
}

pub(crate) fn normalize_remote_path(pathname: &str) -> String {
    let mut segments = Vec::new();

    for segment in pathname.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                let _ = segments.pop();
            }
            _ => segments.push(segment),
        }
    }

    if segments.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", segments.join("/"))
    }
}

pub(crate) fn resolve_remote_path(root_path: &str, pathname: &str) -> String {
    if pathname.trim().is_empty() {
        return normalize_remote_path(root_path);
    }

    if pathname.starts_with('/') {
        return normalize_remote_path(pathname);
    }

    let base = root_path.trim_end_matches('/');
    let combined = if base.is_empty() || base == "/" {
        format!("/{pathname}")
    } else {
        format!("{base}/{pathname}")
    };

    normalize_remote_path(&combined)
}

pub(crate) fn escape_sftp_argument(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

pub(crate) fn sanitize_filename(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();

    if sanitized.is_empty() {
        "download".to_string()
    } else {
        sanitized
    }
}

pub(crate) fn is_valid_environment_key(value: &str) -> bool {
    let mut characters = value.chars();
    match characters.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }

    characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

pub(crate) fn get_channel_environment(
    environment: &Option<HashMap<String, String>>,
) -> Option<Vec<(String, String)>> {
    let environment = environment.as_ref()?;
    let entries = environment
        .iter()
        .filter(|(key, _)| is_valid_environment_key(key))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<Vec<_>>();

    if entries.is_empty() {
        None
    } else {
        Some(entries)
    }
}

pub(crate) fn encode_session_message(message_type: &str, payload: Value) -> String {
    let mut object = serde_json::Map::new();
    object.insert("type".to_string(), Value::String(message_type.to_string()));
    if let Value::Object(fields) = payload {
        object.extend(fields);
    }
    Value::Object(object).to_string()
}

pub(crate) fn build_environment_export_prefix(
    environment: &Option<HashMap<String, String>>,
) -> String {
    get_channel_environment(environment)
        .unwrap_or_default()
        .into_iter()
        .map(|(key, value)| format!("export {key}={}", shell_single_quote(&value)))
        .collect::<Vec<_>>()
        .join("; ")
}

pub(crate) fn build_interactive_shell_command(
    environment: &Option<HashMap<String, String>>,
) -> Option<String> {
    let export_prefix = build_environment_export_prefix(environment);
    if export_prefix.is_empty() {
        None
    } else {
        Some(format!(r#"{export_prefix}; exec "${{SHELL:-/bin/sh}}" -l"#))
    }
}

pub(crate) fn build_exec_command(
    command: &str,
    environment: &Option<HashMap<String, String>>,
) -> String {
    let export_prefix = build_environment_export_prefix(environment);
    if export_prefix.is_empty() {
        command.to_string()
    } else {
        format!("{export_prefix}; {command}")
    }
}

pub(crate) fn normalize_key_algorithm(value: &str) -> String {
    let algorithm = value.to_ascii_uppercase();

    if algorithm.contains("ED25519") {
        "ED25519".to_string()
    } else if algorithm.contains("ECDSA") {
        "ECDSA".to_string()
    } else if algorithm.contains("RSA") {
        "RSA".to_string()
    } else {
        "UNKNOWN".to_string()
    }
}

pub(crate) fn parse_ssh_keygen_summary(
    summary: &str,
    resolved_path: &str,
) -> Result<KeyMetadata, String> {
    let trimmed = summary.trim();
    let parts = trimmed.split_whitespace().collect::<Vec<_>>();
    if parts.len() < 4 {
        return Err(format!("Unexpected ssh-keygen output: {trimmed}"));
    }

    let bits = parts[0]
        .parse::<u32>()
        .map_err(|_| format!("Unexpected ssh-keygen output (bit length): {trimmed}"))?;
    let fingerprint = parts[1].to_string();
    let (comment_prefix, algorithm_suffix) = trimmed
        .rsplit_once(" (")
        .ok_or_else(|| format!("Unexpected ssh-keygen output: {trimmed}"))?;
    let algorithm_raw = algorithm_suffix
        .strip_suffix(')')
        .ok_or_else(|| format!("Unexpected ssh-keygen output: {trimmed}"))?;
    let comment = comment_prefix
        .strip_prefix(&format!("{} {} ", parts[0], fingerprint))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            PathBuf::from(resolved_path)
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| "Imported key".to_string())
        });
    let public_key_path = {
        let candidate = PathBuf::from(format!("{resolved_path}.pub"));
        if candidate.exists() {
            Some(candidate.to_string_lossy().into_owned())
        } else {
            None
        }
    };

    Ok(KeyMetadata {
        algorithm: normalize_key_algorithm(algorithm_raw),
        bits,
        fingerprint,
        comment,
        private_key_path: resolved_path.to_string(),
        public_key_path,
    })
}

/// M01 / #83: write a pasted private key body to disk with 0600 perms,
/// then run the same inspect path generate_key_pair uses on success.
///
/// Refuses to overwrite an existing file (caller must delete first).
/// Normalizes line endings + ensures the body ends with a single LF
/// — some clipboards strip the trailing newline and ssh-keygen
/// rejects keys without it.
pub(crate) fn import_private_key_from_body(path: &str, body: &str) -> Result<KeyMetadata, String> {
    if path.trim().is_empty() {
        return Err("A destination path is required".to_string());
    }
    if body.trim().is_empty() {
        return Err("A key body is required".to_string());
    }
    let resolved_path = expand_home(path);
    validate_user_owned_key_path(&resolved_path)?;
    if let Some(parent) = resolved_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if resolved_path.exists() {
        return Err("Target private key path already exists".to_string());
    }

    let mut normalized = body.replace("\r\n", "\n").replace('\r', "\n");
    while normalized.ends_with('\n') {
        normalized.pop();
    }
    normalized.push('\n');

    // Atomic create (O_EXCL, 0600) closes the check->write TOCTOU window above:
    // a file or symlink planted between the exists() check and here makes the
    // create fail rather than overwriting or following it. Mirrors
    // write_private_file (which the write path already uses).
    write_private_file(&resolved_path, normalized.as_bytes(), 0o600)?;

    let path_string = resolved_path.to_string_lossy().into_owned();
    inspect_private_key(&path_string)
}

pub(crate) fn inspect_private_key(pathname: &str) -> Result<KeyMetadata, String> {
    let resolved_path = expand_home(pathname);
    validate_user_owned_key_path(&resolved_path)?;
    fs::metadata(&resolved_path).map_err(|error| error.to_string())?;
    let resolved_path = resolved_path.to_string_lossy().into_owned();
    let output = Command::new("/usr/bin/ssh-keygen")
        .args(["-lf", &resolved_path])
        .output()
        .map_err(|error| error.to_string())?;
    let stdout = trim_ssh_output(&String::from_utf8_lossy(&output.stdout));
    let stderr = trim_ssh_output(&String::from_utf8_lossy(&output.stderr));

    if !output.status.success() {
        return Err(if stderr.is_empty() {
            if stdout.is_empty() {
                format!("ssh-keygen exited with status {}", output.status)
            } else {
                stdout
            }
        } else {
            stderr
        });
    }

    parse_ssh_keygen_summary(&stdout, &resolved_path)
}

pub(crate) fn generate_key_pair(request: &GenerateKeyRequest) -> Result<KeyMetadata, String> {
    if request.path.trim().is_empty() {
        return Err("Target private key path is required".to_string());
    }

    let key_type = request.key_type.trim().to_ascii_lowercase();
    if !matches!(key_type.as_str(), "ed25519" | "ecdsa" | "rsa") {
        return Err("Unsupported key type".to_string());
    }

    let resolved_path = expand_home(&request.path);
    validate_user_owned_key_path(&resolved_path)?;
    if let Some(parent) = resolved_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    if resolved_path.exists() {
        return Err("Target private key path already exists".to_string());
    }

    let resolved_path_string = resolved_path.to_string_lossy().into_owned();
    let mut args = vec![
        "-q".to_string(),
        "-t".to_string(),
        key_type.clone(),
        "-f".to_string(),
        resolved_path_string.clone(),
        "-N".to_string(),
        request.passphrase.clone(),
        "-C".to_string(),
        request.comment.clone(),
    ];

    if key_type == "rsa" {
        args.splice(3..3, ["-b".to_string(), "4096".to_string()]);
    } else if key_type == "ecdsa" {
        args.splice(3..3, ["-b".to_string(), "521".to_string()]);
    }

    let output = Command::new("/usr/bin/ssh-keygen")
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    let stdout = trim_ssh_output(&String::from_utf8_lossy(&output.stdout));
    let stderr = trim_ssh_output(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Err(if stderr.is_empty() {
            if stdout.is_empty() {
                format!("ssh-keygen exited with status {}", output.status)
            } else {
                stdout
            }
        } else {
            stderr
        });
    }

    inspect_private_key(&resolved_path_string)
}

pub(crate) fn compute_public_key_fingerprint(public_key: &str) -> Result<String, String> {
    let decoded_key = BASE64_STANDARD
        .decode(public_key.as_bytes())
        .map_err(|error| error.to_string())?;
    let digest = Sha256::digest(decoded_key);
    Ok(format!(
        "SHA256:{}",
        BASE64_STANDARD.encode(digest).trim_end_matches('=')
    ))
}

pub(crate) fn scan_known_host(
    request: &KnownHostScanRequest,
) -> Result<KnownHostScanResponse, String> {
    if request.hostname.trim().is_empty() {
        return Err("Hostname is required for host key scans".to_string());
    }

    if request.port == 0 {
        return Err("Port must be greater than zero".to_string());
    }

    let output = Command::new("/usr/bin/ssh-keyscan")
        .args([
            "-p",
            &request.port.to_string(),
            "-T",
            "5",
            &request.hostname,
        ])
        .output()
        .map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = trim_ssh_output(&String::from_utf8_lossy(&output.stderr));

    let entries = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let _scanned_host = parts.next()?;
            let algorithm = parts.next()?.to_string();
            let public_key = parts.next()?.to_string();
            Some((algorithm, public_key))
        })
        .map(|(algorithm, public_key)| {
            Ok(KnownHostScanResult {
                algorithm,
                fingerprint: compute_public_key_fingerprint(&public_key)?,
                hostname: request.hostname.clone(),
                port: request.port,
                public_key,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    if entries.is_empty() {
        return Err(if stderr.is_empty() {
            "No host keys returned from ssh-keyscan".to_string()
        } else {
            stderr
        });
    }

    Ok(KnownHostScanResponse { entries })
}

pub(crate) fn known_hosts_host_pattern(host: &BackendHostConnection) -> String {
    if host.port == 22 {
        host.hostname.clone()
    } else {
        format!("[{}]:{}", host.hostname, host.port)
    }
}

pub(crate) fn append_connection_chain<'a>(
    host: &'a BackendHostConnection,
    chain: &mut Vec<&'a BackendHostConnection>,
) {
    if let Some(jump_host) = host.jump_host.as_deref() {
        append_connection_chain(jump_host, chain);
    }

    chain.push(host);
}

pub(crate) fn build_connection_chain(host: &BackendHostConnection) -> Vec<&BackendHostConnection> {
    let mut chain = Vec::new();
    append_connection_chain(host, &mut chain);
    chain
}

pub(crate) fn build_ssh_host_alias(index: usize, last_index: usize) -> String {
    if index == last_index {
        "termsnip-target".to_string()
    } else {
        format!("termsnip-hop-{index}")
    }
}

pub(crate) fn build_prompt_responses(host: &BackendHostConnection) -> Vec<PromptResponse> {
    let mut responses = Vec::new();

    for connection in build_connection_chain(host) {
        if connection.auth_method == "privateKey" && !connection.passphrase.is_empty() {
            responses.push(PromptResponse {
                kind: PromptResponseKind::Passphrase,
                value: connection.passphrase.clone(),
            });
        }

        if connection.auth_method == "password" && !connection.password.is_empty() {
            responses.push(PromptResponse {
                kind: PromptResponseKind::Password,
                value: connection.password.clone(),
            });
        }
    }

    responses
}

pub(crate) fn detect_prompt_kind(buffer: &str) -> Option<PromptResponseKind> {
    let lowercase = buffer.to_ascii_lowercase();

    if lowercase.contains("passphrase for key") && lowercase.contains(':') {
        return Some(PromptResponseKind::Passphrase);
    }

    if lowercase.contains("password:") {
        return Some(PromptResponseKind::Password);
    }

    None
}

pub(crate) fn take_prompt_response(
    responses: &mut Vec<PromptResponse>,
    kind: PromptResponseKind,
) -> Option<PromptResponse> {
    let index = responses
        .iter()
        .position(|response| response.kind == kind)?;
    Some(responses.remove(index))
}

pub(crate) fn create_native_ssh_session_dir(session_id: &str) -> Result<PathBuf, String> {
    create_native_ssh_session_dir_with_suffixes(session_id, std::iter::empty::<String>())
}

#[cfg(unix)]
fn native_ssh_session_root() -> Result<PathBuf, String> {
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "HOME env var is not set".to_string())?;
    native_ssh_session_root_from(env::temp_dir(), home)
}

#[cfg(unix)]
fn native_ssh_session_root_from(temp_root: PathBuf, home: PathBuf) -> Result<PathBuf, String> {
    let home_metadata = fs::metadata(&home).map_err(|error| error.to_string())?;
    let user_uid = home_metadata.uid();

    if let Ok(metadata) = fs::metadata(&temp_root) {
        if metadata.uid() == user_uid && metadata.mode() & 0o002 == 0 {
            return Ok(temp_root);
        }
    }

    let fallback_root = home.join(".terminal-workspace").join("tmp");
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    builder.mode(0o700);
    builder
        .create(&fallback_root)
        .map_err(|error| error.to_string())?;
    fs::set_permissions(&fallback_root, fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())?;

    let metadata = fs::metadata(&fallback_root).map_err(|error| error.to_string())?;
    if metadata.uid() != user_uid || metadata.mode() & 0o002 != 0 {
        return Err(format!(
            "Refusing to stage SSH material in insecure temp root: {}",
            fallback_root.display()
        ));
    }

    Ok(fallback_root)
}

#[cfg(not(unix))]
fn native_ssh_session_root() -> Result<PathBuf, String> {
    Ok(env::temp_dir())
}

// Kept deliberately short: the session dir holds the ControlMaster socket
// (control.sock), and a macOS AF_UNIX path must stay under 104 bytes. A long
// prefix here plus the per-user TMPDIR root (/var/folders/.../T on macOS) and a
// random suffix overflows that limit and breaks ssh multiplexing. See #150.
pub(crate) const NATIVE_SSH_DIR_PREFIX: &str = "tw-ssh-";

fn create_native_ssh_session_dir_with_suffixes(
    session_id: &str,
    suffixes: impl IntoIterator<Item = String>,
) -> Result<PathBuf, String> {
    let temp_root = native_ssh_session_root()?;
    create_native_ssh_session_dir_in_root(&temp_root, session_id, suffixes)
}

fn create_native_ssh_session_dir_in_root(
    temp_root: &Path,
    session_id: &str,
    suffixes: impl IntoIterator<Item = String>,
) -> Result<PathBuf, String> {
    let mut suffixes = suffixes.into_iter();
    let mut last_error = None;

    for attempt in 0..8 {
        let suffix = suffixes
            .next()
            .unwrap_or_else(|| random_session_suffix(session_id, attempt));
        let directory = temp_root.join(format!("{NATIVE_SSH_DIR_PREFIX}{suffix}"));
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        builder.mode(0o700);

        match builder.create(&directory) {
            Ok(()) => return Ok(directory),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                last_error = Some(error);
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Err(last_error
        .map(|error| error.to_string())
        .unwrap_or_else(|| "failed to create native SSH session directory".to_string()))
}

// 8 bytes (16 hex chars) of entropy: 2^64 is unguessable, and the real defense
// against pre-planting is the exclusive 0700 create — this only needs to avoid
// collision and prediction. Kept short so the control.sock path stays < 104
// bytes (see NATIVE_SSH_DIR_PREFIX / #150).
fn random_session_suffix(session_id: &str, attempt: usize) -> String {
    let mut bytes = [0u8; 8];
    if fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .is_ok()
    {
        return hex_encode(&bytes);
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(session_id.as_bytes());
    hasher.update(std::process::id().to_ne_bytes());
    hasher.update(timestamp.to_ne_bytes());
    hasher.update(attempt.to_ne_bytes());
    hex_encode(&hasher.finalize()[..8])
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn sanitized_staging_stem(alias: &str) -> String {
    let mut stem = alias
        .chars()
        .map(|ch| {
            if ch == '/' || ch == '\\' || ch.is_control() {
                '_'
            } else {
                ch
            }
        })
        .collect::<String>();

    if stem.trim_matches('.').is_empty() {
        stem = "identity".to_string();
    }

    stem
}

fn write_private_file(path: &Path, contents: impl AsRef<[u8]>, mode: u32) -> Result<(), String> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(mode);
    #[cfg(not(unix))]
    let _ = mode;
    let mut file = options.open(path).map_err(|error| error.to_string())?;
    file.write_all(contents.as_ref())
        .map_err(|error| error.to_string())
}

fn scrub_passphrase_file(path: &Path, len: usize) {
    // A passphrase file that fails to zero/unlink leaves plaintext key material
    // on disk — surface it instead of swallowing, so the failure is diagnosable.
    if let Err(error) = fs::write(path, vec![0u8; len]) {
        eprintln!(
            "warning: failed to overwrite passphrase file {}: {error}",
            path.display()
        );
    }
    if let Err(error) = fs::remove_file(path) {
        eprintln!(
            "warning: failed to remove passphrase file {}: {error}",
            path.display()
        );
    }
}

pub(crate) fn write_native_known_hosts(
    host: &BackendHostConnection,
    session_dir: &PathBuf,
) -> Result<PathBuf, String> {
    let known_hosts_path = session_dir.join("known_hosts");
    let mut entries = Vec::new();

    for connection in build_connection_chain(host) {
        if let (Some(algorithm), Some(public_key)) = (
            connection.known_host_algorithm.as_ref(),
            connection.known_host_public_key.as_ref(),
        ) {
            entries.push(format!(
                "{} {} {}",
                known_hosts_host_pattern(connection),
                algorithm,
                public_key
            ));
        }
    }

    write_private_file(&known_hosts_path, entries.join("\n"), 0o600)?;
    Ok(known_hosts_path)
}

pub(crate) fn prepare_native_identity_file(
    connection: &BackendHostConnection,
    session_dir: &Path,
    alias: &str,
) -> Result<String, String> {
    let resolved_path = expand_home(&connection.private_key_path);
    if connection.passphrase.trim().is_empty() {
        return Ok(resolved_path.to_string_lossy().into_owned());
    }

    let staging_stem = sanitized_staging_stem(alias);
    let target_path = session_dir.join(format!("{staging_stem}-identity"));
    let mut source_file = fs::File::open(&resolved_path).map_err(|error| error.to_string())?;
    let mut target_options = fs::OpenOptions::new();
    target_options.write(true).create_new(true);
    #[cfg(unix)]
    target_options.mode(0o600);
    let mut target_file = target_options
        .open(&target_path)
        .map_err(|error| error.to_string())?;
    io::copy(&mut source_file, &mut target_file).map_err(|error| error.to_string())?;

    let target_path_string = target_path.to_string_lossy().into_owned();

    // The passphrase MUST NOT appear in argv (`ps` would expose it). Instead
    // write it to a 0600 sibling file in our session-private temp dir, then
    // hand ssh-keygen an SSH_ASKPASS script that prints the file. We scrub
    // both files before returning. See parity-and-hardening-review.md §3.S-2.
    let pass_path = session_dir.join(format!("{staging_stem}-pass"));
    let askpass_path = session_dir.join(format!("{staging_stem}-askpass.sh"));

    write_private_file(&pass_path, connection.passphrase.as_bytes(), 0o600)
        .map_err(|error| format!("failed to stage passphrase: {error}"))?;

    // The askpass script must print the passphrase to stdout and nothing else.
    // We use `cat` rather than embedding the passphrase in the script body so
    // the script itself can be read without leaking the secret.
    let askpass_body = format!(
        "#!/bin/sh\nexec /bin/cat -- {}\n",
        shell_single_quote(&pass_path.to_string_lossy())
    );
    if let Err(error) = write_private_file(&askpass_path, askpass_body, 0o700) {
        scrub_passphrase_file(&pass_path, connection.passphrase.len());
        return Err(format!("failed to stage askpass: {error}"));
    }

    let output_result = Command::new("/usr/bin/ssh-keygen")
        .args(["-p", "-N", "", "-f", &target_path_string])
        .env("SSH_ASKPASS", &askpass_path)
        // SSH_ASKPASS_REQUIRE=force makes ssh-keygen prefer the askpass even
        // when a TTY is attached. Available in OpenSSH >= 8.4 (macOS 12+).
        .env("SSH_ASKPASS_REQUIRE", "force")
        // ssh-keygen historically only consults SSH_ASKPASS when DISPLAY is
        // set. Any non-empty value suffices; the askpass script ignores it.
        .env("DISPLAY", ":0")
        // Detach from any inherited TTY so ssh-keygen falls through to askpass.
        .stdin(Stdio::null())
        .output();

    // Best-effort scrub: overwrite then unlink. We do this whether ssh-keygen
    // succeeded or failed, before returning either path.
    scrub_passphrase_file(&pass_path, connection.passphrase.len());
    let _ = fs::remove_file(&askpass_path);

    let output = output_result.map_err(|error| error.to_string())?;
    let stdout = trim_ssh_output(&String::from_utf8_lossy(&output.stdout));
    let stderr = trim_ssh_output(&String::from_utf8_lossy(&output.stderr));

    if !output.status.success() {
        return Err(if stderr.is_empty() {
            if stdout.is_empty() {
                format!("ssh-keygen exited with status {}", output.status)
            } else {
                stdout
            }
        } else {
            stderr
        });
    }

    Ok(target_path_string)
}

/// Single-quote a string for safe inclusion in a POSIX shell script.
/// Single-quoted strings have no escapes except for `'` itself, which we
/// handle by closing the quote, inserting `\'`, and reopening.
pub(crate) fn shell_single_quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('\'');
    for ch in value.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

pub(crate) fn build_native_ssh_config(
    host: &BackendHostConnection,
    session_dir: &PathBuf,
    known_hosts_path: &PathBuf,
    control_path: Option<&PathBuf>,
) -> Result<(PathBuf, String), String> {
    let config_path = session_dir.join("ssh_config");
    let chain = build_connection_chain(host);
    let last_index = chain.len().saturating_sub(1);
    let jump_aliases = chain
        .iter()
        .enumerate()
        .filter(|(index, _)| *index != last_index)
        .map(|(index, _)| build_ssh_host_alias(index, last_index))
        .collect::<Vec<_>>();
    let target_alias = build_ssh_host_alias(last_index, last_index);
    let mut lines = Vec::new();

    for (index, connection) in chain.iter().enumerate() {
        let alias = build_ssh_host_alias(index, last_index);
        lines.push(format!("Host {alias}"));
        lines.push(format!("  HostName {}", connection.hostname));
        lines.push(format!("  User {}", connection.username));
        lines.push(format!("  Port {}", connection.port));
        lines.push("  RequestTTY force".to_string());
        lines.push("  LogLevel ERROR".to_string());
        lines.push("  BatchMode no".to_string());
        lines.push("  ServerAliveInterval 15".to_string());
        lines.push("  ServerAliveCountMax 3".to_string());
        // #173: bound the TCP/handshake phase so a dead or filtered host fails
        // fast instead of hanging on the OS default connect timeout (~2 min).
        lines.push("  ConnectTimeout 15".to_string());
        lines.push("  GlobalKnownHostsFile /dev/null".to_string());
        lines.push(format!(
            "  UserKnownHostsFile {}",
            known_hosts_path.to_string_lossy()
        ));
        if let Some(control_path) = control_path {
            lines.push("  ControlMaster auto".to_string());
            lines.push(format!("  ControlPath {}", control_path.to_string_lossy()));
            lines.push("  ControlPersist no".to_string());
        }

        if connection.known_host_public_key.is_some() && connection.known_host_algorithm.is_some() {
            lines.push("  StrictHostKeyChecking yes".to_string());
        } else {
            // Security: never `no` (which silently accepts CHANGED keys too).
            // `accept-new` trusts an unknown key on first use but still fails on
            // a changed key. requireTrusted hops are gated earlier in
            // validate_ssh_host and take the `yes` branch above.
            lines.push("  StrictHostKeyChecking accept-new".to_string());
        }

        if connection.agent_forwarding {
            lines.push("  ForwardAgent yes".to_string());
        } else {
            lines.push("  ForwardAgent no".to_string());
        }

        match connection.auth_method.as_str() {
            "privateKey" => {
                let identity_path = prepare_native_identity_file(connection, session_dir, &alias)?;
                lines.push(format!("  IdentityFile {}", identity_path));
                lines.push("  IdentitiesOnly yes".to_string());
                lines.push("  PreferredAuthentications publickey".to_string());
            }
            "password" => {
                lines.push("  PubkeyAuthentication no".to_string());
                lines.push("  PreferredAuthentications keyboard-interactive,password".to_string());
                lines.push("  NumberOfPasswordPrompts 1".to_string());
            }
            _ => {}
        }

        if index == last_index && !jump_aliases.is_empty() {
            lines.push(format!("  ProxyJump {}", jump_aliases.join(",")));
        }

        lines.push(String::new());
    }

    write_private_file(&config_path, lines.join("\n"), 0o600)?;
    Ok((config_path, target_alias))
}

pub(crate) fn symbolic_permissions_to_octal(value: &str) -> Option<String> {
    let mode = value.as_bytes();
    if mode.len() < 10 {
        return None;
    }

    let triads = [&mode[1..4], &mode[4..7], &mode[7..10]];
    let digits = triads
        .iter()
        .map(|triad| {
            let mut digit = 0;
            if triad[0] != b'-' {
                digit += 4;
            }
            if triad[1] != b'-' {
                digit += 2;
            }
            if triad[2] != b'-' {
                digit += 1;
            }
            char::from(b'0' + digit)
        })
        .collect::<String>();

    Some(digits)
}

pub(crate) fn parse_sftp_modified_at(month: &str, day: &str, time_or_year: &str) -> Option<String> {
    let month = match month {
        "Jan" => 1,
        "Feb" => 2,
        "Mar" => 3,
        "Apr" => 4,
        "May" => 5,
        "Jun" => 6,
        "Jul" => 7,
        "Aug" => 8,
        "Sep" => 9,
        "Oct" => 10,
        "Nov" => 11,
        "Dec" => 12,
        _ => return None,
    };
    let day = day.parse::<u32>().ok()?;

    if let Some((hour, minute)) = time_or_year.split_once(':') {
        let hour = hour.parse::<u32>().ok()?;
        let minute = minute.parse::<u32>().ok()?;
        let now = Utc::now();
        let mut timestamp = Utc
            .with_ymd_and_hms(now.year(), month, day, hour, minute, 0)
            .single()?;
        if timestamp > now + chrono::Duration::days(1) {
            timestamp = Utc
                .with_ymd_and_hms(now.year() - 1, month, day, hour, minute, 0)
                .single()?;
        }
        return Some(timestamp.to_rfc3339());
    }

    let year = time_or_year.parse::<i32>().ok()?;
    let date = NaiveDate::from_ymd_opt(year, month, day)?;
    Some(
        Utc.from_utc_datetime(&date.and_hms_opt(0, 0, 0)?)
            .to_rfc3339(),
    )
}

pub(crate) fn parse_sftp_directory_listing(
    target_path: &str,
    output: &str,
) -> Vec<RemoteFileEntry> {
    let mut entries = output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty()
                || trimmed.starts_with("Connected to ")
                || trimmed.starts_with("Remote working directory:")
            {
                return None;
            }

            let parts = trimmed.split_whitespace().collect::<Vec<_>>();
            if parts.len() < 9 {
                return None;
            }

            let mode = parts[0];
            let raw_name = parts[8..].join(" ");
            let raw_name = raw_name
                .split(" -> ")
                .next()
                .unwrap_or(&raw_name)
                .to_string();
            let name = raw_name.rsplit('/').next().unwrap_or(&raw_name).to_string();
            if name == "." || name == ".." {
                return None;
            }

            let size = parts[4].parse::<u64>().ok()?;
            let kind = if mode.starts_with('d') {
                "directory"
            } else {
                "file"
            };

            Some(RemoteFileEntry {
                kind: kind.to_string(),
                modified_at: parse_sftp_modified_at(parts[5], parts[6], parts[7]),
                name: name.clone(),
                path: resolve_remote_path(target_path, &name),
                permissions: symbolic_permissions_to_octal(mode),
                size,
            })
        })
        .collect::<Vec<_>>();

    entries.sort_by(
        |left, right| match (left.kind.as_str(), right.kind.as_str()) {
            ("directory", "file") => std::cmp::Ordering::Less,
            ("file", "directory") => std::cmp::Ordering::Greater,
            _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
        },
    );

    entries
}

pub(crate) fn trim_ssh_output(value: &str) -> String {
    value
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn run_sftp_batch_commands(
    host: &BackendHostConnection,
    context: &NativeSshControlContext,
    commands: &[String],
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: DEFAULT_TERMINAL_ROWS,
            cols: DEFAULT_TERMINAL_COLS,
            pixel_width: DEFAULT_TERMINAL_PIXEL_WIDTH,
            pixel_height: DEFAULT_TERMINAL_PIXEL_HEIGHT,
        })
        .map_err(|error| error.to_string())?;

    let mut command = CommandBuilder::new("/usr/bin/sftp");
    command.arg("-q");
    command.arg("-o");
    command.arg("RequestTTY=no");
    command.arg("-F");
    command.arg(context.config_path.to_string_lossy().into_owned());
    command.arg(context.target_alias.clone());

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    drop(pair.slave);

    let writer = Arc::new(Mutex::new(
        pair.master
            .take_writer()
            .map_err(|error| error.to_string())?,
    ));
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let master = pair.master;
    let (output_sender, output_receiver) = std::sync::mpsc::channel();
    spawn_jump_session_reader(
        reader,
        writer.clone(),
        build_prompt_responses(host),
        output_sender,
    );

    let result = (|| -> Result<String, String> {
        let mut session_output = wait_for_sftp_prompt(&mut child, &output_receiver, "")?;

        for command in commands {
            let interactive_command = command.trim_start_matches('@');
            write_jump_session_input(&writer, &format!("{interactive_command}\n"))?;
            let command_output =
                wait_for_sftp_prompt(&mut child, &output_receiver, interactive_command)?;
            session_output.push_str(&command_output);
        }

        write_jump_session_input(&writer, "bye\n")?;
        Ok(trim_ssh_output(&session_output))
    })();

    let _ = child.kill();
    let _ = child.wait();
    drop(master);

    result
}

pub(crate) fn check_native_ssh_control_session(
    config_path: &Path,
    target_alias: &str,
) -> Result<(), String> {
    let output = Command::new("/usr/bin/ssh")
        .arg("-F")
        .arg(config_path)
        .arg("-o")
        .arg("RequestTTY=no")
        .arg("-O")
        .arg("check")
        .arg(target_alias)
        .output()
        .map_err(|error| error.to_string())?;
    let stdout = trim_ssh_output(&String::from_utf8_lossy(&output.stdout));
    let stderr = trim_ssh_output(&String::from_utf8_lossy(&output.stderr));

    if output.status.success() {
        Ok(())
    } else if stderr.is_empty() {
        if stdout.is_empty() {
            Err(format!(
                "ssh control check exited with status {}",
                output.status
            ))
        } else {
            Err(stdout)
        }
    } else {
        Err(stderr)
    }
}

pub(crate) fn extract_sftp_prompt_output(output: &str, pending_command: &str) -> Option<String> {
    let normalized = output.replace("\r", "");
    let prompt_index = normalized.rfind("sftp>")?;
    let command_echo = pending_command.trim();
    let mut body = normalized[..prompt_index].to_string();

    if !command_echo.is_empty() {
        let trimmed = body.trim_start_matches('\n');
        let echo_with_newline = format!("{command_echo}\n");
        if let Some(remainder) = trimmed.strip_prefix(&echo_with_newline) {
            body = remainder.to_string();
        } else if trimmed == command_echo {
            body.clear();
        }
    }

    Some(body)
}

pub(crate) fn wait_for_sftp_prompt(
    child: &mut Box<dyn Child + Send + Sync>,
    output_receiver: &std::sync::mpsc::Receiver<JumpSessionEvent>,
    pending_command: &str,
) -> Result<String, String> {
    let started_at = Instant::now();
    let mut captured_output = String::new();

    loop {
        loop {
            match output_receiver.try_recv() {
                Ok(JumpSessionEvent::Output(output)) => {
                    captured_output.push_str(&output);
                    if let Some(prompt_output) =
                        extract_sftp_prompt_output(&captured_output, pending_command)
                    {
                        return Ok(prompt_output);
                    }
                }
                Ok(JumpSessionEvent::Error(error)) => {
                    captured_output.push_str(&error);
                    return Err(trim_ssh_output(&captured_output));
                }
                Ok(JumpSessionEvent::Eof) => {
                    let message = trim_ssh_output(&captured_output);
                    return Err(if message.is_empty() {
                        "sftp exited before becoming ready".to_string()
                    } else {
                        message
                    });
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    let message = trim_ssh_output(&captured_output);
                    return Err(if message.is_empty() {
                        "sftp output stream disconnected unexpectedly".to_string()
                    } else {
                        message
                    });
                }
            }
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                let message = trim_ssh_output(&captured_output);
                return Err(if message.is_empty() {
                    format!("sftp exited with status {status}")
                } else {
                    message
                });
            }
            Ok(None) => {}
            Err(error) => return Err(error.to_string()),
        }

        if started_at.elapsed() > Duration::from_millis(NATIVE_SSH_CONTROL_READY_TIMEOUT_MS) {
            let message = trim_ssh_output(&captured_output);
            return Err(if message.is_empty() {
                "Timed out while waiting for the sftp prompt".to_string()
            } else {
                message
            });
        }

        thread::sleep(Duration::from_millis(NATIVE_SESSION_POLL_INTERVAL_MS));
    }
}

pub(crate) fn open_native_ssh_control_session(
    host: &BackendHostConnection,
    session_label: &str,
) -> Result<
    (
        NativeSshControlContext,
        Box<dyn Child + Send + Sync>,
        Box<dyn MasterPty + Send>,
    ),
    String,
> {
    let session_dir = create_native_ssh_session_dir(session_label)?;
    let result = (|| -> Result<
        (
            NativeSshControlContext,
            Box<dyn Child + Send + Sync>,
            Box<dyn MasterPty + Send>,
        ),
        String,
    > {
        let known_hosts_path = write_native_known_hosts(host, &session_dir)?;
        let control_path = session_dir.join("control.sock");
        let (config_path, target_alias) =
            build_native_ssh_config(host, &session_dir, &known_hosts_path, Some(&control_path))?;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: DEFAULT_TERMINAL_ROWS,
                cols: DEFAULT_TERMINAL_COLS,
                pixel_width: DEFAULT_TERMINAL_PIXEL_WIDTH,
                pixel_height: DEFAULT_TERMINAL_PIXEL_HEIGHT,
            })
            .map_err(|error| error.to_string())?;

        let mut command = CommandBuilder::new("/usr/bin/ssh");
        command.arg("-F");
        command.arg(config_path.to_string_lossy().into_owned());
        command.arg("-N");
        command.arg(target_alias.clone());

        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| error.to_string())?;
        drop(pair.slave);

        let writer = Arc::new(Mutex::new(
            pair.master
                .take_writer()
                .map_err(|error| error.to_string())?,
        ));
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| error.to_string())?;
        let master = pair.master;
        let (output_sender, output_receiver) = std::sync::mpsc::channel();
        spawn_jump_session_reader(reader, writer, build_prompt_responses(host), output_sender);

        let started_at = Instant::now();
        let mut captured_output = String::new();
        loop {
            loop {
                match output_receiver.try_recv() {
                    Ok(JumpSessionEvent::Output(output)) => {
                        captured_output.push_str(&output);
                    }
                    Ok(JumpSessionEvent::Error(error)) => {
                        captured_output.push_str(&error);
                        return Err(trim_ssh_output(&captured_output));
                    }
                    Ok(JumpSessionEvent::Eof) => {
                        break;
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => break,
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
                }
            }

            if control_path.exists()
                && check_native_ssh_control_session(&config_path, &target_alias).is_ok()
            {
                break;
            }

            if started_at.elapsed() > Duration::from_millis(NATIVE_SSH_CONTROL_READY_TIMEOUT_MS) {
                let _ = child.kill();
                let _ = child.wait();
                let message = trim_ssh_output(&captured_output);
                return Err(if message.is_empty() {
                    "Timed out while opening native SSH control session".to_string()
                } else {
                    message
                });
            }

            match child.try_wait() {
                Ok(Some(status)) => {
                    let message = trim_ssh_output(&captured_output);
                    return Err(if message.is_empty() {
                        format!("SSH control session exited with status {status}")
                    } else {
                        message
                    });
                }
                Ok(None) => {}
                Err(error) => return Err(error.to_string()),
            }

            thread::sleep(Duration::from_millis(NATIVE_SESSION_POLL_INTERVAL_MS));
        }

        Ok((
            NativeSshControlContext {
                config_path,
                session_dir: session_dir.clone(),
                target_alias,
            },
            child,
            master,
        ))
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&session_dir);
    }

    result
}

pub(crate) fn with_native_ssh_control_session<T, F>(
    host: &BackendHostConnection,
    session_label: &str,
    operation: F,
) -> Result<T, String>
where
    F: FnOnce(&NativeSshControlContext) -> Result<T, String>,
{
    let (context, mut child, master) = open_native_ssh_control_session(host, session_label)?;
    let result = operation(&context);
    let _ = child.kill();
    let _ = child.wait();
    drop(master);
    let _ = fs::remove_dir_all(&context.session_dir);
    result
}

/// Wall-clock ceiling for a single snippet command. `run_native_ssh_command`
/// used `Command::output()`, which reads to EOF with no timeout, so a target
/// whose command never terminates (`tail -f`, a stuck pager, a wedged network
/// after the TCP handshake) blocked the worker forever and — via the blind
/// `join()` in `execute_native_snippet_request` — froze the whole fan-out
/// uncancellably. The child is killed once this deadline passes (#173).
const NATIVE_SNIPPET_COMMAND_TIMEOUT_MS: u64 = 60_000;

/// Poll cadence while waiting for a snippet child to exit or time out.
const NATIVE_SNIPPET_POLL_INTERVAL_MS: u64 = 50;

/// Upper bound on concurrent snippet targets. Each in-flight target holds an
/// OS thread, an ssh control-master process, and a private session dir; an
/// unbounded fan-out over a large fleet risks fd/process exhaustion (#173).
const NATIVE_SNIPPET_MAX_CONCURRENCY: usize = 8;

/// Result of running a child under a wall-clock deadline.
enum TimedCommand {
    Completed(Output),
    TimedOut,
}

/// Run `command`, capturing stdout/stderr, but kill the child if it has not
/// exited within `timeout`. Dedicated reader threads drain the pipes so a
/// child that produces more output than the pipe buffer holds cannot deadlock
/// before the deadline fires.
fn run_command_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<TimedCommand, String> {
    use std::io::Read;

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let mut stdout_pipe = child.stdout.take().expect("stdout was piped");
    let mut stderr_pipe = child.stderr.take().expect("stderr was piped");
    let stdout_reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buffer);
        buffer
    });
    let stderr_reader = thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buffer);
        buffer
    });

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let status = loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => break status,
            None => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let status = child.wait().map_err(|error| error.to_string())?;
                    timed_out = true;
                    break status;
                }
                thread::sleep(Duration::from_millis(NATIVE_SNIPPET_POLL_INTERVAL_MS));
            }
        }
    };

    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    if timed_out {
        Ok(TimedCommand::TimedOut)
    } else {
        Ok(TimedCommand::Completed(Output {
            status,
            stdout,
            stderr,
        }))
    }
}

pub(crate) fn run_native_ssh_command(
    context: &NativeSshControlContext,
    command: &str,
) -> Result<Output, String> {
    let mut ssh = Command::new("/usr/bin/ssh");
    ssh.arg("-F")
        .arg(&context.config_path)
        .arg("-o")
        .arg("RequestTTY=no")
        .arg(&context.target_alias)
        .arg(format!("sh -lc {}", shell_single_quote(command)));
    match run_command_with_timeout(
        ssh,
        Duration::from_millis(NATIVE_SNIPPET_COMMAND_TIMEOUT_MS),
    )? {
        TimedCommand::Completed(output) => Ok(output),
        TimedCommand::TimedOut => Err(format!(
            "Command did not finish within {}s and was terminated",
            NATIVE_SNIPPET_COMMAND_TIMEOUT_MS / 1000
        )),
    }
}

pub(crate) fn run_native_ssh_control_command(
    context: &NativeSshControlContext,
    control_command: &str,
    forward_flag: &str,
    forward_spec: &str,
) -> Result<String, String> {
    let output = Command::new("/usr/bin/ssh")
        .arg("-F")
        .arg(&context.config_path)
        .arg("-o")
        .arg("RequestTTY=no")
        .arg("-O")
        .arg(control_command)
        .arg(forward_flag)
        .arg(forward_spec)
        .arg(&context.target_alias)
        .output()
        .map_err(|error| error.to_string())?;
    let stdout = trim_ssh_output(&String::from_utf8_lossy(&output.stdout));
    let stderr = trim_ssh_output(&String::from_utf8_lossy(&output.stderr));

    if output.status.success() {
        if stdout.is_empty() {
            Ok(stderr)
        } else {
            Ok(stdout)
        }
    } else if stderr.is_empty() {
        if stdout.is_empty() {
            Err(format!(
                "ssh control command exited with status {}",
                output.status
            ))
        } else {
            Err(stdout)
        }
    } else {
        Err(stderr)
    }
}

pub(crate) fn validate_forward_payload(payload: &CreateForwardPayload) -> Result<(), String> {
    if payload.session_id.trim().is_empty() {
        return Err("Forward is missing a session id".to_string());
    }

    if payload.local_host.trim().is_empty() || payload.remote_host.trim().is_empty() {
        return Err("Forward hostnames are required".to_string());
    }

    if payload.local_port == 0 || payload.remote_port == 0 {
        return Err("Forward ports must be greater than zero".to_string());
    }

    if payload.direction != "local" && payload.direction != "remote" {
        return Err("Unsupported forward direction".to_string());
    }

    Ok(())
}

pub(crate) fn format_forward_host(value: &str) -> String {
    if value.contains(':') && !value.starts_with('[') {
        format!("[{value}]")
    } else {
        value.to_string()
    }
}

pub(crate) fn build_forward_spec(payload: &CreateForwardPayload) -> String {
    match payload.direction.as_str() {
        "remote" => format!(
            "{}:{}:{}:{}",
            format_forward_host(&payload.remote_host),
            payload.remote_port,
            format_forward_host(&payload.local_host),
            payload.local_port
        ),
        _ => format!(
            "{}:{}:{}:{}",
            format_forward_host(&payload.local_host),
            payload.local_port,
            format_forward_host(&payload.remote_host),
            payload.remote_port
        ),
    }
}

pub(crate) fn execute_native_snippet_target(
    target: SnippetExecutionTarget,
    command: String,
) -> SnippetExecutionResult {
    match validate_ssh_host(&target.host) {
        Ok(()) => {}
        Err(error) => {
            return SnippetExecutionResult {
                target_id: target.id,
                label: target.label,
                ok: false,
                stdout: String::new(),
                stderr: String::new(),
                exit_code: None,
                error_message: Some(error),
            };
        }
    }

    let session_label = next_native_session_id();
    let resolved_command = build_exec_command(&command, &target.host.environment);
    let output = match with_native_ssh_control_session(&target.host, &session_label, |context| {
        run_native_ssh_command(context, &resolved_command)
    }) {
        Ok(output) => output,
        Err(error) => {
            return SnippetExecutionResult {
                target_id: target.id,
                label: target.label,
                ok: false,
                stdout: String::new(),
                stderr: String::new(),
                exit_code: None,
                error_message: Some(error),
            };
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code();

    SnippetExecutionResult {
        target_id: target.id,
        label: target.label,
        ok: output.status.success(),
        stdout,
        stderr: stderr.clone(),
        exit_code,
        error_message: if output.status.success() {
            None
        } else {
            Some(if stderr.trim().is_empty() {
                format!("Command exited with code {}", exit_code.unwrap_or(-1))
            } else {
                stderr.trim().to_string()
            })
        },
    }
}

pub(crate) fn list_session_forwards(
    native_forwards: &NativeForwardRegistry,
    session_id: &str,
) -> ListForwardsResponse {
    ListForwardsResponse {
        forwards: list_native_forwards(native_forwards, session_id),
    }
}

pub(crate) fn create_native_forward(
    native_sessions: &NativeSessionRegistry,
    native_forwards: &NativeForwardRegistry,
    request: CreateForwardPayload,
) -> Result<PortForwardRecord, String> {
    validate_forward_payload(&request)?;
    let session = get_native_session(native_sessions, &request.session_id)
        .ok_or_else(|| "Session not found".to_string())?;
    let forward_id = next_native_forward_id();
    let (context, mut child, master) = open_native_ssh_control_session(&session.host, &forward_id)?;
    let forward_flag = if request.direction == "remote" {
        "-R"
    } else {
        "-L"
    };
    let forward_output = run_native_ssh_control_command(
        &context,
        "forward",
        forward_flag,
        &build_forward_spec(&request),
    );

    let assigned_remote_port = match forward_output {
        Ok(output) => {
            if request.direction == "remote" && request.remote_port == 0 {
                // A dynamically-assigned remote port that fails to parse means
                // we cannot report the working forward's real port; surface it
                // as an error rather than misreporting port 0.
                match output.trim().parse::<u16>() {
                    Ok(port) => port,
                    Err(_) => {
                        let _ = child.kill();
                        let _ = child.wait();
                        drop(master);
                        let _ = fs::remove_dir_all(&context.session_dir);
                        return Err(format!(
                            "Could not parse the assigned remote-forward port from ssh output: {}",
                            output.trim()
                        ));
                    }
                }
            } else {
                request.remote_port
            }
        }
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            drop(master);
            let _ = fs::remove_dir_all(&context.session_dir);
            return Err(error);
        }
    };

    let record = PortForwardRecord {
        created_at: Utc::now().to_rfc3339(),
        direction: request.direction.clone(),
        id: forward_id.clone(),
        local_host: request.local_host.clone(),
        local_port: request.local_port,
        remote_host: request.remote_host.clone(),
        remote_port: assigned_remote_port,
        session_id: request.session_id.clone(),
    };
    let killer = Arc::new(Mutex::new(child.clone_killer()));
    let registry = native_forwards.clone();
    let forward_id_for_thread = forward_id.clone();
    let session_dir = context.session_dir.clone();

    thread::spawn(move || {
        let _ = child.wait();
        drop(master);
        let _ = remove_native_forward(&registry, &forward_id_for_thread);
        let _ = fs::remove_dir_all(&session_dir);
    });

    insert_native_forward(
        native_forwards,
        &forward_id,
        NativeForwardHandle {
            killer,
            record: record.clone(),
        },
    );

    Ok(record)
}

pub(crate) fn delete_native_forward(
    native_forwards: &NativeForwardRegistry,
    forward_id: &str,
) -> BackendBooleanResponse {
    if let Some(handle) = remove_native_forward(native_forwards, forward_id) {
        close_native_forward_handle(handle);
    }

    BackendBooleanResponse {
        ok: true,
        pending: None,
    }
}

/// Run `worker` over `items` on at most `max_concurrency` OS threads and return
/// the results in the original item order. This replaces the previous
/// thread-per-item fan-out so a large fleet can no longer exhaust fds/processes
/// (#173). `worker` must not panic: callers wrap panicky work and return a value
/// that represents the failure (see `execute_native_snippet_request`).
fn run_bounded<T, R>(
    items: Vec<T>,
    max_concurrency: usize,
    worker: Arc<dyn Fn(T) -> R + Send + Sync>,
) -> Vec<R>
where
    T: Send + 'static,
    R: Send + 'static,
{
    use std::sync::mpsc;

    let total = items.len();
    if total == 0 {
        return Vec::new();
    }
    let concurrency = max_concurrency.max(1).min(total);

    let (task_tx, task_rx) = mpsc::channel::<(usize, T)>();
    let task_rx = Arc::new(Mutex::new(task_rx));
    let (result_tx, result_rx) = mpsc::channel::<(usize, R)>();

    let mut handles = Vec::with_capacity(concurrency);
    for _ in 0..concurrency {
        let task_rx = Arc::clone(&task_rx);
        let result_tx = result_tx.clone();
        let worker = Arc::clone(&worker);
        handles.push(thread::spawn(move || loop {
            // Release the queue lock before running the (slow) worker so the
            // other threads keep pulling — the lock only guards `recv`.
            let next = {
                let guard = task_rx.lock().expect("task queue mutex poisoned");
                guard.recv()
            };
            match next {
                Ok((index, item)) => {
                    let _ = result_tx.send((index, worker(item)));
                }
                Err(_) => break,
            }
        }));
    }

    for (index, item) in items.into_iter().enumerate() {
        let _ = task_tx.send((index, item));
    }
    drop(task_tx);
    drop(result_tx);

    let mut slots: Vec<Option<R>> = (0..total).map(|_| None).collect();
    for (index, result) in result_rx {
        slots[index] = Some(result);
    }
    for handle in handles {
        let _ = handle.join();
    }

    slots
        .into_iter()
        .map(|slot| slot.expect("every task produced a result"))
        .collect()
}

pub(crate) fn execute_native_snippet_request(
    request: SnippetExecutionRequest,
) -> Result<SnippetExecutionResponse, String> {
    let command = request.command.trim().to_string();
    if command.is_empty() {
        return Err("Snippet command is required".to_string());
    }

    if request.targets.is_empty() {
        return Err("At least one target host is required".to_string());
    }

    let command = Arc::new(command);
    let worker: Arc<dyn Fn(SnippetExecutionTarget) -> SnippetExecutionResult + Send + Sync> = {
        let command = Arc::clone(&command);
        Arc::new(move |target: SnippetExecutionTarget| {
            let target_id = target.id.clone();
            let label = target.label.clone();
            let next_command = (*command).clone();
            // A panic in one target must not poison the shared worker thread or
            // drop that target's result slot — turn it into a failed result.
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                execute_native_snippet_target(target, next_command)
            }))
            .unwrap_or_else(|_| SnippetExecutionResult {
                target_id,
                label,
                ok: false,
                stdout: String::new(),
                stderr: String::new(),
                exit_code: None,
                error_message: Some("Snippet execution worker panicked".to_string()),
            })
        })
    };

    let results = run_bounded(request.targets, NATIVE_SNIPPET_MAX_CONCURRENCY, worker);
    Ok(SnippetExecutionResponse { results })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::{symlink, PermissionsExt};
    use std::{
        process,
        time::{SystemTime, UNIX_EPOCH},
    };

    /// Run `/bin/sh -c <script>` and return trimmed-free stdout verbatim.
    fn sh_stdout(script: &str) -> String {
        let output = Command::new("/bin/sh")
            .arg("-c")
            .arg(script)
            .output()
            .expect("sh should execute");
        assert!(
            output.status.success(),
            "sh exited non-zero for script {script:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).expect("stdout should be utf8")
    }

    #[test]
    fn shell_single_quote_wraps_and_escapes_embedded_quote() {
        // POSIX form: a single quote becomes '\'' (close, escaped quote, reopen).
        assert_eq!(shell_single_quote("abc"), "'abc'");
        assert_eq!(shell_single_quote("a'b"), "'a'\\''b'");
        assert_eq!(shell_single_quote(""), "''");
    }

    #[test]
    fn shell_single_quote_round_trips_hostile_values_through_sh() {
        // Every value must reach the shell as a single, literal word — no
        // corruption on ordinary quotes and no breakout on metacharacters.
        // This mirrors run_native_ssh_command's `sh -lc <quoted>` and
        // build_environment_export_prefix's `export k=<quoted>`.
        for value in [
            "it's done",
            "awk '{print $1}'",
            "plain",
            "x'; id #",
            "`id`",
            "$(id)",
            "a\"b",
            "line1\nline2",
            "semi;colon && echo pwned",
        ] {
            let script = format!("printf '%s' {}", shell_single_quote(value));
            assert_eq!(
                sh_stdout(&script),
                value,
                "value {value:?} was corrupted or broke out of quoting"
            );
        }
    }

    #[test]
    fn build_environment_export_prefix_quotes_injection_values() {
        let mut env = HashMap::new();
        env.insert("TOKEN".to_string(), "x'; id #".to_string());
        let prefix = build_environment_export_prefix(&Some(env));
        // The export line, when evaluated, must set TOKEN to the literal value
        // rather than executing the injected `id`.
        let script = format!("{prefix}; printf '%s' \"$TOKEN\"");
        assert_eq!(sh_stdout(&script), "x'; id #");
    }

    fn test_suffix(label: &str) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        format!("{label}-{}-{nanos}", process::id())
    }

    fn test_root(label: &str) -> PathBuf {
        let root = native_ssh_session_root()
            .expect("native SSH session root should be available")
            .join(format!("termsnip-native-test-{}", test_suffix(label)));
        fs::create_dir_all(&root).expect("test root should be created");
        root
    }

    #[test]
    fn parse_ssh_keygen_summary_rejects_non_numeric_bits() {
        // A non-numeric bit length must error rather than silently become 0.
        let bad = "notanumber SHA256:abcdef testkey (ED25519)";
        assert!(parse_ssh_keygen_summary(bad, "/tmp/key").is_err());
    }

    #[test]
    fn parse_ssh_keygen_summary_parses_valid_bits() {
        let good = "256 SHA256:abcdef testkey (ED25519)";
        let meta = parse_ssh_keygen_summary(good, "/tmp/key").expect("valid summary parses");
        assert_eq!(meta.bits, 256);
    }

    #[cfg(unix)]
    #[test]
    fn write_private_file_refuses_existing_path() {
        // The O_EXCL (create_new) guarantee import_private_key_from_body now
        // relies on: a second write to the same path must fail, not overwrite.
        let root = test_root("write-private");
        let path = root.join("key");
        write_private_file(&path, b"first", 0o600).expect("first write should succeed");
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600,
            "file should be created 0600"
        );
        assert!(
            write_private_file(&path, b"second", 0o600).is_err(),
            "writing over an existing path must fail"
        );
        assert_eq!(fs::read(&path).unwrap(), b"first", "original content preserved");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scrub_passphrase_file_zeroes_and_removes() {
        let root = test_root("scrub");
        let path = root.join("passphrase");
        fs::write(&path, b"super-secret").unwrap();
        scrub_passphrase_file(&path, "super-secret".len());
        assert!(!path.exists(), "passphrase file must be removed after scrub");
        let _ = fs::remove_dir_all(&root);
    }

    fn ssh_keygen_available() -> bool {
        PathBuf::from("/usr/bin/ssh-keygen").exists()
    }

    fn generate_test_key(path: &Path, passphrase: &str) {
        if !ssh_keygen_available() {
            eprintln!("skipping ssh-keygen-dependent assertion: /usr/bin/ssh-keygen missing");
            return;
        }

        let output = Command::new("/usr/bin/ssh-keygen")
            .args([
                "-q",
                "-t",
                "ed25519",
                "-C",
                "termsnip-native-test",
                "-N",
                passphrase,
                "-f",
                &path.to_string_lossy(),
            ])
            .output()
            .expect("ssh-keygen should run");
        assert!(
            output.status.success(),
            "ssh-keygen failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn test_host(private_key_path: &Path, passphrase: &str) -> BackendHostConnection {
        BackendHostConnection {
            agent_forwarding: false,
            auth_method: "privateKey".to_string(),
            environment: None,
            host_key_policy: None,
            hostname: "host.internal".to_string(),
            jump_host: None,
            known_host_algorithm: Some("ssh-ed25519".to_string()),
            known_host_public_key: Some("AAAATEST".to_string()),
            password: String::new(),
            passphrase: passphrase.to_string(),
            port: 22,
            private_key_path: private_key_path.to_string_lossy().into_owned(),
            protocol: "ssh".to_string(),
            sftp_root: None,
            username: "deploy".to_string(),
        }
    }

    #[test]
    #[cfg(unix)]
    fn native_ssh_config_sets_connect_and_keepalive_timeouts() {
        let session_dir = create_native_ssh_session_dir("native-connect-timeout")
            .expect("session dir should be created");
        let mut host = test_host(Path::new("/nonexistent/id_ed25519"), "");
        // password auth avoids staging an identity file for a missing key.
        host.auth_method = "password".to_string();
        let known_hosts_path = session_dir.join("known_hosts");
        let (config_path, _) =
            build_native_ssh_config(&host, &session_dir, &known_hosts_path, None)
                .expect("ssh config should be generated");
        let config = fs::read_to_string(&config_path).expect("config should be readable");

        assert!(
            config.contains("ConnectTimeout 15"),
            "generated config is missing ConnectTimeout:\n{config}"
        );
        assert!(config.contains("ServerAliveInterval 15"));

        let _ = fs::remove_dir_all(session_dir);
    }

    #[test]
    #[cfg(unix)]
    fn run_command_with_timeout_kills_a_hung_child() {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("sleep 30");
        let started = Instant::now();
        let outcome = run_command_with_timeout(command, Duration::from_millis(200))
            .expect("spawning sleep should succeed");

        assert!(matches!(outcome, TimedCommand::TimedOut));
        // The watchdog must return promptly rather than waiting out the child.
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "run_command_with_timeout blocked past its deadline"
        );
    }

    #[test]
    #[cfg(unix)]
    fn run_command_with_timeout_captures_a_fast_command() {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("printf hello");
        let outcome = run_command_with_timeout(command, Duration::from_secs(10))
            .expect("spawning printf should succeed");

        match outcome {
            TimedCommand::Completed(output) => {
                assert!(output.status.success());
                assert_eq!(String::from_utf8_lossy(&output.stdout), "hello");
            }
            TimedCommand::TimedOut => panic!("a fast command must not time out"),
        }
    }

    #[test]
    fn run_bounded_preserves_order_and_caps_concurrency() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let inflight = Arc::new(AtomicUsize::new(0));
        let max_seen = Arc::new(AtomicUsize::new(0));
        let inflight_worker = Arc::clone(&inflight);
        let max_seen_worker = Arc::clone(&max_seen);
        let worker: Arc<dyn Fn(usize) -> usize + Send + Sync> = Arc::new(move |value: usize| {
            let current = inflight_worker.fetch_add(1, Ordering::SeqCst) + 1;
            max_seen_worker.fetch_max(current, Ordering::SeqCst);
            thread::sleep(Duration::from_millis(20));
            inflight_worker.fetch_sub(1, Ordering::SeqCst);
            value * 2
        });

        let results = run_bounded((0..12).collect(), 3, worker);

        assert_eq!(results, (0..12).map(|value| value * 2).collect::<Vec<_>>());
        let peak = max_seen.load(Ordering::SeqCst);
        assert!(peak <= 3, "concurrency {peak} exceeded the cap of 3");
        assert!(peak >= 2, "expected the pool to run targets in parallel");
    }

    #[test]
    #[cfg(unix)]
    fn test_session_dir_root_is_per_user_tmpdir() {
        let root = native_ssh_session_root().expect("native SSH session root should resolve");
        let dir = create_native_ssh_session_dir("native-7")
            .expect("session dir should be created under private root");

        assert!(dir.starts_with(&root));
        assert_ne!(dir, PathBuf::from("/tmp/termsnip-native-ssh-native-7"));
        assert_ne!(
            dir.file_name().and_then(|name| name.to_str()),
            Some(format!("{NATIVE_SSH_DIR_PREFIX}native-7").as_str())
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_session_dir_name_is_unpredictable() {
        let first = create_native_ssh_session_dir("native-7").expect("first dir should be created");
        let second =
            create_native_ssh_session_dir("native-7").expect("second dir should be created");

        assert_ne!(first, second);
        assert_ne!(
            first.file_name().and_then(|name| name.to_str()),
            Some(format!("{NATIVE_SSH_DIR_PREFIX}native-7").as_str())
        );
        assert_ne!(
            second.file_name().and_then(|name| name.to_str()),
            Some(format!("{NATIVE_SSH_DIR_PREFIX}native-7").as_str())
        );

        let _ = fs::remove_dir_all(first);
        let _ = fs::remove_dir_all(second);
    }

    #[test]
    #[cfg(unix)]
    fn test_control_socket_path_within_unix_limit() {
        // ssh ControlMaster binds session_dir/control.sock, and a macOS AF_UNIX
        // path must stay under 104 bytes. Guard the total path length so the
        // dir prefix + random suffix can never overflow it again (#150).
        let dir =
            create_native_ssh_session_dir("native-ctlpath").expect("session dir should be created");
        let control_len = dir.join("control.sock").to_string_lossy().len();
        assert!(
            control_len < 104,
            "control socket path is {control_len} bytes (must be < 104): {}",
            dir.display()
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    #[cfg(unix)]
    fn test_session_dir_is_0700() {
        let dir =
            create_native_ssh_session_dir("native-mode").expect("session dir should be created");
        let mode = fs::metadata(&dir)
            .expect("session dir metadata should be readable")
            .permissions()
            .mode()
            & 0o777;

        assert_eq!(mode, 0o700);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    #[cfg(unix)]
    fn test_session_dir_creation_is_exclusive_no_symlink_follow() {
        let root = native_ssh_session_root().expect("native SSH session root should resolve");
        let attacker_dir = test_root("attacker");
        let first_suffix = test_suffix("preplanted");
        let second_suffix = test_suffix("retry");
        let planted_path = root.join(format!("{NATIVE_SSH_DIR_PREFIX}{first_suffix}"));
        symlink(&attacker_dir, &planted_path).expect("attacker symlink should be planted");

        let dir = create_native_ssh_session_dir_with_suffixes(
            "native-7",
            vec![first_suffix, second_suffix.clone()],
        )
        .expect("session dir creation should retry after symlink collision");

        assert_eq!(
            dir.file_name().and_then(|name| name.to_str()),
            Some(format!("{NATIVE_SSH_DIR_PREFIX}{second_suffix}").as_str())
        );
        assert!(fs::read_dir(&attacker_dir)
            .expect("attacker dir should be readable")
            .next()
            .is_none());

        let _ = fs::remove_file(planted_path);
        let _ = fs::remove_dir_all(attacker_dir);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_session_dir_collision_retries() {
        let root = native_ssh_session_root().expect("native SSH session root should resolve");
        let first_suffix = test_suffix("collision");
        let second_suffix = test_suffix("collision-retry");
        let collision_path = root.join(format!("{NATIVE_SSH_DIR_PREFIX}{first_suffix}"));
        fs::create_dir(&collision_path).expect("collision dir should be created");

        let dir = create_native_ssh_session_dir_with_suffixes(
            "native-7",
            vec![first_suffix, second_suffix.clone()],
        )
        .expect("session dir creation should retry after existing dir");

        assert_eq!(
            dir.file_name().and_then(|name| name.to_str()),
            Some(format!("{NATIVE_SSH_DIR_PREFIX}{second_suffix}").as_str())
        );

        let _ = fs::remove_dir_all(collision_path);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_no_plaintext_key_at_predictable_path() {
        if !ssh_keygen_available() {
            eprintln!("skipping test: /usr/bin/ssh-keygen missing");
            return;
        }

        let root = test_root("plaintext-key");
        let key_path = root.join("id_ed25519");
        let passphrase = "fixture-passphrase";
        generate_test_key(&key_path, passphrase);
        let session_id = format!("native-keytest-{}", test_suffix("predictable"));
        let predictable_path = PathBuf::from(format!("/tmp/termsnip-native-ssh-{session_id}"));
        let session_dir =
            create_native_ssh_session_dir(&session_id).expect("session dir should be created");
        let staged_path = prepare_native_identity_file(
            &test_host(&key_path, passphrase),
            &session_dir,
            "native-0",
        )
        .expect("identity should be staged");

        assert!(PathBuf::from(staged_path).exists());
        assert!(!predictable_path.exists());

        let _ = fs::remove_dir_all(session_dir);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_empty_passphrase_returns_original_path() {
        let root = test_root("empty-passphrase");
        let key_path = root.join("id_ed25519");
        fs::write(&key_path, "not-used").expect("key placeholder should be written");
        let session_dir =
            create_native_ssh_session_dir("native-empty").expect("session dir should be created");

        let returned =
            prepare_native_identity_file(&test_host(&key_path, " \t\n"), &session_dir, "native-0")
                .expect("empty passphrase should return original path");

        assert_eq!(returned, key_path.to_string_lossy());
        assert!(fs::read_dir(&session_dir)
            .expect("session dir should be readable")
            .next()
            .is_none());

        let _ = fs::remove_dir_all(session_dir);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_identity_alias_with_unicode() {
        let root = test_root("unicode-alias");
        let key_path = root.join("id_ed25519");
        fs::write(&key_path, "not-a-real-key").expect("key placeholder should be written");
        let session_dir =
            create_native_ssh_session_dir("native-unicode").expect("session dir should be created");

        let result = prepare_native_identity_file(
            &test_host(&key_path, "passphrase"),
            &session_dir,
            "natïve/../☃\n",
        );

        assert!(result.is_err());
        assert!(fs::read_dir(&session_dir)
            .expect("session dir should be readable")
            .any(|entry| {
                entry
                    .expect("dir entry should be readable")
                    .file_name()
                    .to_string_lossy()
                    .contains("natïve_.._☃_")
            }));

        let _ = fs::remove_dir_all(session_dir);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn test_concurrent_sessions_get_distinct_dirs() {
        let handles = (0..8)
            .map(|_| {
                thread::spawn(|| {
                    create_native_ssh_session_dir("native-7")
                        .expect("session dir should be created")
                })
            })
            .collect::<Vec<_>>();
        let mut dirs = handles
            .into_iter()
            .map(|handle| handle.join().expect("thread should not panic"))
            .collect::<Vec<_>>();
        dirs.sort();
        dirs.dedup();

        assert_eq!(dirs.len(), 8);

        for dir in dirs {
            let _ = fs::remove_dir_all(dir);
        }
    }

    #[test]
    #[cfg(unix)]
    fn test_tmpdir_unset_falls_back_safely() {
        let home = test_root("home");
        fs::set_permissions(&home, fs::Permissions::from_mode(0o700))
            .expect("test home permissions should be set");

        let root = native_ssh_session_root_from(PathBuf::from("/tmp"), home.clone())
            .expect("native SSH session root should fall back from world-writable /tmp");
        let dir = create_native_ssh_session_dir_in_root(
            &root,
            "native-unset-tmpdir",
            std::iter::empty::<String>(),
        )
        .expect("session dir should be created with simulated TMPDIR unset");
        let root_metadata = fs::metadata(&root).expect("root metadata should be readable");
        let dir_mode = fs::metadata(&dir)
            .expect("dir metadata should be readable")
            .permissions()
            .mode()
            & 0o777;

        assert!(dir.starts_with(&home));
        assert_eq!(root_metadata.mode() & 0o002, 0);
        assert_eq!(dir_mode, 0o700);

        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn test_scrub_on_keygen_failure() {
        if !ssh_keygen_available() {
            eprintln!("skipping test: /usr/bin/ssh-keygen missing");
            return;
        }

        let root = test_root("keygen-failure");
        let key_path = root.join("invalid_key");
        fs::write(&key_path, "not-a-private-key").expect("invalid key should be written");
        let session_dir =
            create_native_ssh_session_dir("native-failure").expect("session dir should be created");

        let result =
            prepare_native_identity_file(&test_host(&key_path, "passphrase"), &session_dir, "bad");

        assert!(result.is_err());
        assert!(!session_dir.join("bad-pass").exists());
        assert!(!session_dir.join("bad-askpass.sh").exists());

        let _ = fs::remove_dir_all(session_dir);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[cfg(unix)]
    fn test_staged_files_stay_inside_0700_dir() {
        if !ssh_keygen_available() {
            eprintln!("skipping test: /usr/bin/ssh-keygen missing");
            return;
        }

        let root = test_root("staged-files");
        let key_path = root.join("id_ed25519");
        let passphrase = "fixture-passphrase";
        generate_test_key(&key_path, passphrase);
        let session_dir =
            create_native_ssh_session_dir("native-staged").expect("session dir should be created");
        let host = test_host(&key_path, passphrase);
        let known_hosts_path =
            write_native_known_hosts(&host, &session_dir).expect("known_hosts should be staged");
        let identity_path = PathBuf::from(
            prepare_native_identity_file(&host, &session_dir, "native-0")
                .expect("identity should be staged"),
        );
        let mut config_host = host.clone();
        config_host.auth_method = "password".to_string();
        let (config_path, _) =
            build_native_ssh_config(&config_host, &session_dir, &known_hosts_path, None)
                .expect("ssh config should be staged");
        let dir_mode = fs::metadata(&session_dir)
            .expect("session dir metadata should be readable")
            .permissions()
            .mode()
            & 0o777;

        assert_eq!(dir_mode, 0o700);
        assert!(known_hosts_path.starts_with(&session_dir));
        assert!(identity_path.starts_with(&session_dir));
        assert!(config_path.starts_with(&session_dir));
        assert_eq!(
            fs::metadata(&known_hosts_path)
                .expect("known_hosts metadata should be readable")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(&identity_path)
                .expect("identity metadata should be readable")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(&config_path)
                .expect("config metadata should be readable")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );

        let _ = fs::remove_dir_all(session_dir);
        let _ = fs::remove_dir_all(root);
    }
}
