use super::*;
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

/// Reject any private-key path the renderer hands us that escapes the user's
/// home directory (or the small set of test/system roots we explicitly allow).
/// Without this guard, a renderer-side XSS could call
/// `termsnip_inspect_private_key` with `/etc/passwd` (or another user's home)
/// to probe file existence and leak metadata via ssh-keygen error messages.
/// See docs/parity-and-hardening-review.md §3.S-6.
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

    // Canonicalize where possible to defeat symlink trickery. If the file does
    // not exist yet (the generate-new-key path), fall back to the literal path
    // — the parent directory must still pass the allowlist check below.
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());

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
    // World-writable /tmp is accepted as a last resort for cross-platform
    // bootstrap flows. /tmp is world-readable, so this guard does not protect
    // against same-host attackers staging a file here — but the threat model
    // for this allowlist is renderer-side XSS reading arbitrary user paths.
    push_with_canonical(PathBuf::from("/tmp"));
    push_with_canonical(PathBuf::from("/private/tmp"));

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

pub(crate) fn escape_shell_value(value: &str) -> String {
    format!("'{}'", value.replace('\'', r#"'\"'\"'"#))
}

pub(crate) fn build_environment_export_prefix(
    environment: &Option<HashMap<String, String>>,
) -> String {
    get_channel_environment(environment)
        .unwrap_or_default()
        .into_iter()
        .map(|(key, value)| format!("export {key}={}", escape_shell_value(&value)))
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

    let bits = parts[0].parse::<u32>().unwrap_or(0);
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
    let temp_root = PathBuf::from("/tmp");
    let directory = temp_root.join(format!("termsnip-native-ssh-{session_id}"));
    if directory.exists() {
        fs::remove_dir_all(&directory).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
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

    fs::write(&known_hosts_path, entries.join("\n")).map_err(|error| error.to_string())?;
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

    let target_path = session_dir.join(format!("{alias}-identity"));
    fs::copy(&resolved_path, &target_path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&target_path, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;

    let target_path_string = target_path.to_string_lossy().into_owned();

    // The passphrase MUST NOT appear in argv (`ps` would expose it). Instead
    // write it to a 0600 sibling file in our session-private temp dir, then
    // hand ssh-keygen an SSH_ASKPASS script that prints the file. We scrub
    // both files before returning. See parity-and-hardening-review.md §3.S-2.
    let pass_path = session_dir.join(format!("{alias}-pass"));
    let askpass_path = session_dir.join(format!("{alias}-askpass.sh"));

    fs::write(&pass_path, connection.passphrase.as_bytes())
        .map_err(|error| format!("failed to stage passphrase: {error}"))?;
    #[cfg(unix)]
    fs::set_permissions(&pass_path, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;

    // The askpass script must print the passphrase to stdout and nothing else.
    // We use `cat` rather than embedding the passphrase in the script body so
    // the script itself can be read without leaking the secret.
    let askpass_body = format!(
        "#!/bin/sh\nexec /bin/cat -- {}\n",
        shell_single_quote(&pass_path.to_string_lossy())
    );
    fs::write(&askpass_path, askpass_body)
        .map_err(|error| format!("failed to stage askpass: {error}"))?;
    #[cfg(unix)]
    fs::set_permissions(&askpass_path, fs::Permissions::from_mode(0o700))
        .map_err(|error| error.to_string())?;

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
    let _ = fs::write(&pass_path, vec![0u8; connection.passphrase.len()]);
    let _ = fs::remove_file(&pass_path);
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
fn shell_single_quote(value: &str) -> String {
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
            lines.push("  StrictHostKeyChecking no".to_string());
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

    fs::write(&config_path, lines.join("\n")).map_err(|error| error.to_string())?;
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

pub(crate) fn run_native_ssh_command(
    context: &NativeSshControlContext,
    command: &str,
) -> Result<Output, String> {
    Command::new("/usr/bin/ssh")
        .arg("-F")
        .arg(&context.config_path)
        .arg("-o")
        .arg("RequestTTY=no")
        .arg(&context.target_alias)
        .arg(format!("sh -lc {}", escape_shell_value(command)))
        .output()
        .map_err(|error| error.to_string())
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
                output.trim().parse::<u16>().ok().unwrap_or(0)
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

    let workers = request
        .targets
        .into_iter()
        .map(|target| {
            let fallback_id = target.id.clone();
            let fallback_label = target.label.clone();
            let next_command = command.clone();
            (
                fallback_id,
                fallback_label,
                thread::spawn(move || execute_native_snippet_target(target, next_command)),
            )
        })
        .collect::<Vec<_>>();
    let mut results = Vec::with_capacity(workers.len());

    for (target_id, label, worker) in workers {
        match worker.join() {
            Ok(result) => results.push(result),
            Err(_) => results.push(SnippetExecutionResult {
                target_id,
                label,
                ok: false,
                stdout: String::new(),
                stderr: String::new(),
                exit_code: None,
                error_message: Some("Snippet execution worker panicked".to_string()),
            }),
        }
    }

    Ok(SnippetExecutionResponse { results })
}
