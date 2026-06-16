use super::*;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::{
    env,
    ffi::OsString,
    fs,
    io::{Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{self, Child as ProcessChild, Command, Stdio},
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::mpsc::unbounded_channel;

const FIXTURE_TIMEOUT: Duration = Duration::from_secs(15);
const FIXTURE_POLL_INTERVAL: Duration = Duration::from_millis(50);

struct TestSshd {
    child: ProcessChild,
}

impl Drop for TestSshd {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct TestHttpServer {
    port: u16,
    join_handle: Option<JoinHandle<()>>,
    shutdown: std::sync::mpsc::Sender<()>,
}

impl Drop for TestHttpServer {
    fn drop(&mut self) {
        let _ = self.shutdown.send(());
        if let Some(join_handle) = self.join_handle.take() {
            let _ = join_handle.join();
        }
    }
}

struct NativeTransportFixture {
    _root: PathBuf,
    _jump_sshd: TestSshd,
    _target_sshd: TestSshd,
    direct_host: BackendHostConnection,
    jump_target_host: BackendHostConnection,
    http_server: TestHttpServer,
}

struct ScopedEnvVar {
    key: &'static str,
    original: Option<OsString>,
}

impl ScopedEnvVar {
    fn set(key: &'static str, value: impl AsRef<std::ffi::OsStr>) -> Self {
        let original = env::var_os(key);
        env::set_var(key, value);
        Self { key, original }
    }
}

impl Drop for ScopedEnvVar {
    fn drop(&mut self) {
        if let Some(value) = self.original.take() {
            env::set_var(self.key, value);
        } else {
            env::remove_var(self.key);
        }
    }
}

impl NativeTransportFixture {
    fn new() -> Self {
        let root = make_fixture_root("transport");
        let client_key_path = root.join("client_key");
        let jump_dir = root.join("jump-sshd");
        let target_dir = root.join("target-sshd");
        let remote_root = root.join("remote-root");
        let username = env::var("USER").expect("USER should be set for native transport fixtures");
        let passphrase = "fixture-passphrase";
        let jump_port = reserve_port();
        let target_port = reserve_port();

        fs::create_dir_all(&jump_dir).expect("jump fixture dir should be created");
        fs::create_dir_all(&target_dir).expect("target fixture dir should be created");
        fs::create_dir_all(&remote_root).expect("remote root should be created");
        fs::write(remote_root.join("README.txt"), "fixture-readme\n")
            .expect("remote readme should be written");
        generate_keypair(&client_key_path, "ed25519", Some(passphrase));
        let client_public_key =
            fs::read_to_string(format!("{}.pub", client_key_path.to_string_lossy()))
                .expect("client public key should be readable");
        fs::write(jump_dir.join("authorized_keys"), &client_public_key)
            .expect("jump authorized_keys should be written");
        fs::write(target_dir.join("authorized_keys"), &client_public_key)
            .expect("target authorized_keys should be written");

        let (jump_algorithm, jump_public_key) =
            generate_host_key(&jump_dir.join("ssh_host_ed25519_key"));
        let (target_algorithm, target_public_key) =
            generate_host_key(&target_dir.join("ssh_host_ed25519_key"));
        let jump_sshd = spawn_sshd(
            &jump_dir,
            jump_port,
            &username,
            &jump_dir.join("authorized_keys"),
            &jump_dir.join("ssh_host_ed25519_key"),
        );
        let target_sshd = spawn_sshd(
            &target_dir,
            target_port,
            &username,
            &target_dir.join("authorized_keys"),
            &target_dir.join("ssh_host_ed25519_key"),
        );
        let http_server = start_http_server();

        let jump_host = BackendHostConnection {
            agent_forwarding: false,
            auth_method: "privateKey".to_string(),
            environment: Some(HashMap::from([(
                "TERMSNIP_FIXTURE".to_string(),
                "jump".to_string(),
            )])),
            host_key_policy: None,
            hostname: "127.0.0.1".to_string(),
            jump_host: None,
            known_host_algorithm: Some(jump_algorithm),
            known_host_public_key: Some(jump_public_key),
            password: String::new(),
            passphrase: passphrase.to_string(),
            port: u32::from(jump_port),
            private_key_path: client_key_path.to_string_lossy().into_owned(),
            protocol: "ssh".to_string(),
            sftp_root: None,
            username: username.clone(),
        };
        let direct_host = BackendHostConnection {
            agent_forwarding: false,
            auth_method: "privateKey".to_string(),
            environment: Some(HashMap::from([(
                "TERMSNIP_FIXTURE".to_string(),
                "direct".to_string(),
            )])),
            host_key_policy: None,
            hostname: "127.0.0.1".to_string(),
            jump_host: None,
            known_host_algorithm: Some(target_algorithm.clone()),
            known_host_public_key: Some(target_public_key.clone()),
            password: String::new(),
            passphrase: passphrase.to_string(),
            port: u32::from(target_port),
            private_key_path: client_key_path.to_string_lossy().into_owned(),
            protocol: "ssh".to_string(),
            sftp_root: Some(remote_root.to_string_lossy().into_owned()),
            username: username.clone(),
        };
        let jump_target_host = BackendHostConnection {
            agent_forwarding: false,
            auth_method: "privateKey".to_string(),
            environment: Some(HashMap::from([(
                "TERMSNIP_FIXTURE".to_string(),
                "jump-target".to_string(),
            )])),
            host_key_policy: None,
            hostname: "127.0.0.1".to_string(),
            jump_host: Some(Box::new(jump_host.clone())),
            known_host_algorithm: Some(target_algorithm),
            known_host_public_key: Some(target_public_key),
            password: String::new(),
            passphrase: passphrase.to_string(),
            port: u32::from(target_port),
            private_key_path: client_key_path.to_string_lossy().into_owned(),
            protocol: "ssh".to_string(),
            sftp_root: Some(remote_root.to_string_lossy().into_owned()),
            username,
        };

        Self {
            _root: root,
            _jump_sshd: jump_sshd,
            _target_sshd: target_sshd,
            direct_host,
            jump_target_host,
            http_server,
        }
    }
}

fn make_fixture_root(label: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_nanos();
    let root = env::temp_dir().join(format!(
        "termsnip-native-{label}-{}-{suffix}",
        process::id()
    ));
    fs::create_dir_all(&root).expect("fixture root should be created");
    root
}

fn reserve_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .expect("ephemeral port should bind")
        .local_addr()
        .expect("ephemeral listener should have an address")
        .port()
}

fn wait_for(description: &str, mut predicate: impl FnMut() -> bool) {
    let started_at = Instant::now();
    while started_at.elapsed() < FIXTURE_TIMEOUT {
        if predicate() {
            return;
        }

        thread::sleep(FIXTURE_POLL_INTERVAL);
    }

    panic!("Timed out while waiting for {description}");
}

fn generate_keypair(path: &Path, key_type: &str, passphrase: Option<&str>) {
    let path_string = path.to_string_lossy().into_owned();
    let mut command = Command::new("/usr/bin/ssh-keygen");
    command.args([
        "-q",
        "-t",
        key_type,
        "-C",
        "termsnip-fixture",
        "-N",
        passphrase.unwrap_or(""),
        "-f",
        &path_string,
    ]);
    if key_type == "rsa" {
        command.args(["-b", "4096"]);
    }
    let output = command.output().expect("ssh-keygen should run");

    if !output.status.success() {
        panic!(
            "ssh-keygen failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

fn generate_host_key(path: &Path) -> (String, String) {
    generate_keypair(path, "rsa", None);
    parse_public_key(&PathBuf::from(format!("{}.pub", path.to_string_lossy())))
}

fn parse_public_key(path: &Path) -> (String, String) {
    let contents = fs::read_to_string(path).expect("public key should be readable");
    let mut parts = contents.split_whitespace();
    let algorithm = parts
        .next()
        .expect("public key should include an algorithm")
        .to_string();
    let public_key = parts
        .next()
        .expect("public key should include a key blob")
        .to_string();
    (algorithm, public_key)
}

fn spawn_sshd(
    root: &Path,
    port: u16,
    username: &str,
    authorized_keys: &Path,
    host_key: &Path,
) -> TestSshd {
    let config_path = root.join("sshd_config");
    let log_path = root.join("sshd.log");
    fs::write(
        &config_path,
        format!(
            "Port {port}\n\
ListenAddress 127.0.0.1\n\
HostKey {}\n\
PidFile {}\n\
AuthorizedKeysFile {}\n\
PasswordAuthentication no\n\
KbdInteractiveAuthentication no\n\
ChallengeResponseAuthentication no\n\
UsePAM no\n\
PubkeyAuthentication yes\n\
AcceptEnv TERMSNIP_FIXTURE\n\
PermitRootLogin no\n\
AllowUsers {username}\n\
StrictModes no\n\
PrintMotd no\n\
PermitTTY yes\n\
AllowTcpForwarding yes\n\
GatewayPorts yes\n\
UseDNS no\n\
LogLevel VERBOSE\n\
Subsystem sftp internal-sftp\n",
            host_key.to_string_lossy(),
            root.join("sshd.pid").to_string_lossy(),
            authorized_keys.to_string_lossy()
        ),
    )
    .expect("sshd config should be written");

    let mut child = Command::new("/usr/sbin/sshd")
        .arg("-D")
        .arg("-f")
        .arg(&config_path)
        .arg("-E")
        .arg(&log_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("sshd should spawn");

    wait_for("fixture sshd to start", || {
        if child
            .try_wait()
            .expect("sshd status should be readable")
            .is_some()
        {
            let log_output = fs::read_to_string(&log_path).unwrap_or_default();
            panic!("Fixture sshd exited early: {log_output}");
        }

        fs::read_to_string(&log_path)
            .map(|output| output.contains(&format!("Server listening on 127.0.0.1 port {port}")))
            .unwrap_or(false)
    });

    TestSshd { child }
}

fn start_http_server() -> TestHttpServer {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("fixture http listener should bind");
    let port = listener
        .local_addr()
        .expect("fixture listener should expose its address")
        .port();
    listener
        .set_nonblocking(true)
        .expect("fixture listener should become nonblocking");
    let (shutdown_sender, shutdown_receiver) = std::sync::mpsc::channel();
    let join_handle = thread::spawn(move || loop {
        if shutdown_receiver.try_recv().is_ok() {
            break;
        }

        match listener.accept() {
            Ok((mut socket, _)) => {
                let mut request_buffer = [0u8; 1024];
                let _ = socket.read(&mut request_buffer);
                let body = b"FORWARD_OK";
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes());
                let _ = socket.write_all(body);
                let _ = socket.flush();
                let _ = socket.shutdown(Shutdown::Both);
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(FIXTURE_POLL_INTERVAL);
            }
            Err(_) => break,
        }
    });

    TestHttpServer {
        port,
        join_handle: Some(join_handle),
        shutdown: shutdown_sender,
    }
}

fn read_http_body(port: u16) -> Result<String, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|error| error.to_string())?;
    stream
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .map_err(|error| error.to_string())?;
    stream.flush().map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    Ok(response
        .split("\r\n\r\n")
        .nth(1)
        .unwrap_or_default()
        .to_string())
}

fn insert_fixture_session(
    registry: &NativeSessionRegistry,
    session_id: &str,
    host: BackendHostConnection,
) {
    let (command_sender, _command_receiver) = unbounded_channel();
    insert_native_session(
        registry,
        session_id,
        NativeSessionHandle {
            command_sender,
            host,
            state: Arc::new(Mutex::new(NativeSessionState {
                buffered_messages: Vec::new(),
                connection_state: "connected".to_string(),
                stream_id: None,
            })),
        },
    );
}

fn write_fixture_executable(path: &Path, contents: &str) {
    fs::write(path, contents).expect("fixture executable should be written");
    #[cfg(unix)]
    {
        let mut permissions = fs::metadata(path)
            .expect("fixture executable metadata should be readable")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions)
            .expect("fixture executable permissions should be set");
    }
}

fn collect_external_command_output(
    child: &mut Box<dyn Child + Send + Sync>,
    receiver: &std::sync::mpsc::Receiver<JumpSessionEvent>,
    expected_marker: &str,
) -> String {
    let started_at = Instant::now();
    let mut output = String::new();

    while started_at.elapsed() < FIXTURE_TIMEOUT {
        loop {
            match receiver.try_recv() {
                Ok(JumpSessionEvent::Output(chunk)) => {
                    output.push_str(&chunk);
                    if output.contains(expected_marker) {
                        return output;
                    }
                }
                Ok(JumpSessionEvent::Error(error)) => {
                    panic!("fixture external command errored: {error}");
                }
                Ok(JumpSessionEvent::Eof) => break,
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            }
        }

        match child.try_wait() {
            Ok(Some(_)) if output.contains(expected_marker) => return output,
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(error) => panic!("fixture external command status should be readable: {error}"),
        }

        thread::sleep(FIXTURE_POLL_INTERVAL);
    }

    panic!("Timed out waiting for fixture output marker `{expected_marker}` in `{output}`");
}

fn run_external_protocol_fixture(
    host: &BackendHostConnection,
    expected_marker: &str,
    manual_input: Option<&str>,
) -> String {
    let session_id = next_native_session_id();
    let ExternalCommandSessionSpec {
        command,
        prompt_responses,
        cleanup_dir,
        ..
    } = build_external_command_session_spec(host, &session_id)
        .expect("fixture external session spec should build");
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: DEFAULT_TERMINAL_ROWS,
            cols: DEFAULT_TERMINAL_COLS,
            pixel_width: DEFAULT_TERMINAL_PIXEL_WIDTH,
            pixel_height: DEFAULT_TERMINAL_PIXEL_HEIGHT,
        })
        .expect("fixture pty should open");

    let mut child = pair
        .slave
        .spawn_command(command)
        .expect("fixture external command should spawn");
    drop(pair.slave);

    let writer = Arc::new(Mutex::new(
        pair.master
            .take_writer()
            .expect("fixture pty writer should be available"),
    ));
    let reader = pair
        .master
        .try_clone_reader()
        .expect("fixture pty reader should clone");
    drop(pair.master);

    let (sender, receiver) = std::sync::mpsc::channel();
    if prompt_responses.is_empty() {
        spawn_local_session_reader(reader, sender);
    } else {
        spawn_jump_session_reader(reader, writer.clone(), prompt_responses, sender);
    }

    if let Some(input) = manual_input {
        write_jump_session_input(&writer, &format!("{input}\n"))
            .expect("fixture external input should write");
    }

    let output = collect_external_command_output(&mut child, &receiver, expected_marker);

    let _ = child.kill();
    let _ = child.wait();
    if let Some(cleanup_dir) = cleanup_dir {
        let _ = fs::remove_dir_all(cleanup_dir);
    }

    output
}

fn read_shell_until(channel: &mut Channel, marker: &str) -> String {
    let mut buffer = [0u8; NATIVE_SESSION_READ_CHUNK_SIZE];
    let mut output = String::new();
    let started_at = Instant::now();

    while started_at.elapsed() < FIXTURE_TIMEOUT {
        match channel.read(&mut buffer) {
            Ok(0) => {
                if channel.eof() {
                    break;
                }
            }
            Ok(count) => {
                output.push_str(&String::from_utf8_lossy(&buffer[..count]));
                if output.contains(marker) {
                    break;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(FIXTURE_POLL_INTERVAL);
            }
            Err(error) => panic!("Failed to read fixture shell output: {error}"),
        }
    }

    output
}

fn assert_native_trust_tooling(fixture: &NativeTransportFixture) {
    let imported_key_metadata = inspect_private_key(&fixture.direct_host.private_key_path)
        .expect("native key inspection should succeed");
    let expected_public_key_path = format!("{}.pub", fixture.direct_host.private_key_path);
    assert_eq!(imported_key_metadata.algorithm, "ED25519");
    assert_eq!(
        imported_key_metadata.public_key_path.as_deref(),
        Some(expected_public_key_path.as_str())
    );
    assert!(!imported_key_metadata.fingerprint.is_empty());

    let generated_key_path = fixture
        ._root
        .join("generated")
        .join("terminal_workspace_fixture_id_ed25519");
    let generated_key_metadata = generate_key_pair(&GenerateKeyRequest {
        comment: "termsnip-generated".to_string(),
        passphrase: "generated-passphrase".to_string(),
        path: generated_key_path.to_string_lossy().into_owned(),
        key_type: "ed25519".to_string(),
    })
    .expect("native key generation should succeed");
    assert_eq!(generated_key_metadata.algorithm, "ED25519");
    assert_eq!(generated_key_metadata.comment, "termsnip-generated");
    assert_eq!(
        generated_key_metadata.private_key_path,
        generated_key_path.to_string_lossy()
    );
    assert!(generated_key_path.exists());
    assert!(PathBuf::from(format!("{}.pub", generated_key_path.to_string_lossy())).exists());

    let rescanned_key_metadata = inspect_private_key(&generated_key_metadata.private_key_path)
        .expect("generated key should be inspectable");
    assert_eq!(
        rescanned_key_metadata.fingerprint,
        generated_key_metadata.fingerprint
    );

    match scan_known_host(&KnownHostScanRequest {
        hostname: fixture.direct_host.hostname.clone(),
        port: u16::try_from(fixture.direct_host.port).expect("fixture direct host port should fit"),
    }) {
        Ok(scanned_known_hosts) => {
            assert!(
                scanned_known_hosts.entries.iter().any(|entry| {
                    entry.algorithm
                        == fixture
                            .direct_host
                            .known_host_algorithm
                            .clone()
                            .unwrap_or_default()
                        && entry.public_key
                            == fixture
                                .direct_host
                                .known_host_public_key
                                .clone()
                                .unwrap_or_default()
                }),
                "entries: {:?}",
                scanned_known_hosts
                    .entries
                    .iter()
                    .map(|entry| format!("{} {}", entry.algorithm, entry.public_key))
                    .collect::<Vec<_>>()
            );
        }
        Err(error) if error.contains("No host keys returned from ssh-keyscan") => {
            eprintln!("Skipping localhost known-host scan fixture in this sandbox: {error}");
        }
        Err(error) => panic!("native known-host scan should succeed: {error}"),
    }
}

#[cfg(target_os = "macos")]
#[test]
fn native_trust_tooling_fixture_flow() {
    let fixture = NativeTransportFixture::new();
    assert_native_trust_tooling(&fixture);
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires an unsandboxed localhost sshd runtime"]
fn localhost_ssh_transport_fixture_flow() {
    let fixture = NativeTransportFixture::new();

    match connect_native_session(&fixture.direct_host) {
        Ok((session, mut channel)) => {
            write_native_session_input(&mut channel, b"printf 'DIRECT_NATIVE_OK\\n'; exit\n")
                .expect("fixture shell command should write");
            let direct_output = read_shell_until(&mut channel, "DIRECT_NATIVE_OK");
            assert!(direct_output.contains("DIRECT_NATIVE_OK"));
            let _ = channel.close();
            let _ = channel.wait_close();
            let _ = session.disconnect(None, "fixture complete", None);
        }
        Err(error) if error.contains("Unable to exchange encryption keys") => {
            eprintln!("Skipping direct native session fixture in this sandbox: {error}");
        }
        Err(error) => panic!("direct native session should connect: {error}"),
    }

    let inspected_key = inspect_private_key(&fixture.direct_host.private_key_path)
        .expect("native private key inspection should succeed");
    assert_eq!(inspected_key.algorithm, "ED25519");
    assert_eq!(
        inspected_key.private_key_path,
        fixture.direct_host.private_key_path
    );
    assert!(inspected_key.public_key_path.is_some());
    assert!(!inspected_key.fingerprint.is_empty());

    let generated_key_root = make_fixture_root("generated-key");
    let generated_key_path = generated_key_root.join("id_fixture_ed25519");
    let generated_key = generate_key_pair(&GenerateKeyRequest {
        comment: "termsnip-generated-fixture".to_string(),
        passphrase: "generated-passphrase".to_string(),
        path: generated_key_path.to_string_lossy().into_owned(),
        key_type: "ed25519".to_string(),
    })
    .expect("native private key generation should succeed");
    assert_eq!(generated_key.algorithm, "ED25519");
    assert_eq!(
        generated_key.private_key_path,
        generated_key_path.to_string_lossy().into_owned()
    );
    assert!(PathBuf::from(&generated_key.private_key_path).exists());
    assert!(generated_key
        .public_key_path
        .as_ref()
        .map(PathBuf::from)
        .is_some_and(|path| path.exists()));

    let expected_public_key = fixture
        .direct_host
        .known_host_public_key
        .clone()
        .expect("fixture direct host should expose a public key");
    let expected_algorithm = fixture
        .direct_host
        .known_host_algorithm
        .clone()
        .expect("fixture direct host should expose an algorithm");
    let expected_fingerprint = compute_public_key_fingerprint(&expected_public_key)
        .expect("fixture direct host fingerprint should compute");
    match scan_known_host(&KnownHostScanRequest {
        hostname: fixture.direct_host.hostname.clone(),
        port: u16::try_from(fixture.direct_host.port).expect("fixture direct host port should fit"),
    }) {
        Ok(scanned_known_hosts) => {
            assert!(
                scanned_known_hosts.entries.iter().any(|entry| {
                    entry.algorithm == expected_algorithm
                        && entry.public_key == expected_public_key
                        && entry.fingerprint == expected_fingerprint
                }),
                "scan entries: {:?}",
                scanned_known_hosts
                    .entries
                    .iter()
                    .map(|entry| {
                        format!(
                            "{} {} {}",
                            entry.hostname, entry.algorithm, entry.fingerprint
                        )
                    })
                    .collect::<Vec<_>>()
            );
        }
        Err(error) if error.contains("No host keys returned from ssh-keyscan") => {
            eprintln!("Skipping localhost known-host scan fixture in this sandbox: {error}");
        }
        Err(error) => panic!("native known-host scan should succeed: {error}"),
    }

    let jump_output = with_native_ssh_control_session(
        &fixture.jump_target_host,
        &next_native_session_id(),
        |context| run_native_ssh_command(context, "printf 'JUMP_NATIVE_OK'"),
    )
    .expect("jump-host native exec should succeed");
    assert!(String::from_utf8_lossy(&jump_output.stdout).contains("JUMP_NATIVE_OK"));

    let listed_directory = terminal_workspace_sftp_list_directory(SftpPathRequest {
        host: fixture.jump_target_host.clone(),
        path: String::new(),
    })
    .expect("native sftp list should succeed");
    assert!(
        listed_directory
            .entries
            .iter()
            .any(|entry| entry.name == "README.txt"),
        "entries: {:?}",
        listed_directory
            .entries
            .iter()
            .map(|entry| entry.name.clone())
            .collect::<Vec<_>>()
    );

    let created_directory = terminal_workspace_sftp_create_directory(SftpPathRequest {
        host: fixture.jump_target_host.clone(),
        path: "nested".to_string(),
    })
    .expect("native sftp mkdir should succeed");
    assert!(created_directory.ok);

    let renamed_directory = terminal_workspace_sftp_rename_entry(SftpRenameRequest {
        current_path: "nested".to_string(),
        host: fixture.jump_target_host.clone(),
        next_path: "nested-renamed".to_string(),
    })
    .expect("native sftp rename should succeed");
    assert!(renamed_directory.path.ends_with("nested-renamed"));

    let uploaded_file = terminal_workspace_sftp_upload_file(SftpUploadRequest {
        contents_base64: BASE64_STANDARD.encode("fixture-upload"),
        filename: "upload.txt".to_string(),
        host: fixture.jump_target_host.clone(),
        path: "upload.txt".to_string(),
    })
    .expect("native sftp upload should succeed");
    assert!(uploaded_file.ok);

    let downloaded_file = terminal_workspace_sftp_download_file(SftpPathRequest {
        host: fixture.jump_target_host.clone(),
        path: "upload.txt".to_string(),
    })
    .expect("native sftp download should succeed");
    assert_eq!(
        BASE64_STANDARD
            .decode(downloaded_file.base64_body.as_bytes())
            .expect("downloaded file should decode"),
        b"fixture-upload"
    );

    let deleted_file = terminal_workspace_sftp_delete_entry(SftpDeleteRequest {
        host: fixture.jump_target_host.clone(),
        is_directory: false,
        path: "upload.txt".to_string(),
    })
    .expect("native sftp file delete should succeed");
    assert!(deleted_file.ok);
    let deleted_directory = terminal_workspace_sftp_delete_entry(SftpDeleteRequest {
        host: fixture.jump_target_host.clone(),
        is_directory: true,
        path: "nested-renamed".to_string(),
    })
    .expect("native sftp directory delete should succeed");
    assert!(deleted_directory.ok);
    assert_native_trust_tooling(&fixture);

    let session_registry = NativeSessionRegistry::default();
    let forward_registry = NativeForwardRegistry::default();
    insert_fixture_session(
        &session_registry,
        "fixture-direct",
        fixture.direct_host.clone(),
    );

    let local_forward_port = reserve_port();
    let local_forward = create_native_forward(
        &session_registry,
        &forward_registry,
        CreateForwardPayload {
            direction: "local".to_string(),
            local_host: "127.0.0.1".to_string(),
            local_port: local_forward_port,
            remote_host: "127.0.0.1".to_string(),
            remote_port: fixture.http_server.port,
            session_id: "fixture-direct".to_string(),
        },
    )
    .expect("native local forward should succeed");
    assert_eq!(
        list_session_forwards(&forward_registry, "fixture-direct")
            .forwards
            .len(),
        1
    );
    wait_for("local forward traffic", || {
        read_http_body(local_forward.local_port)
            .map(|body| body.contains("FORWARD_OK"))
            .unwrap_or(false)
    });
    let stopped_local_forward = delete_native_forward(&forward_registry, &local_forward.id);
    assert!(stopped_local_forward.ok);
    wait_for("local forward teardown", || {
        read_http_body(local_forward.local_port).is_err()
    });

    let remote_forward_port = reserve_port();
    let remote_forward = create_native_forward(
        &session_registry,
        &forward_registry,
        CreateForwardPayload {
            direction: "remote".to_string(),
            local_host: "127.0.0.1".to_string(),
            local_port: fixture.http_server.port,
            remote_host: "127.0.0.1".to_string(),
            remote_port: remote_forward_port,
            session_id: "fixture-direct".to_string(),
        },
    )
    .expect("native remote forward should succeed");
    wait_for("remote forward traffic", || {
        read_http_body(remote_forward.remote_port)
            .map(|body| body.contains("FORWARD_OK"))
            .unwrap_or(false)
    });
    let stopped_remote_forward = delete_native_forward(&forward_registry, &remote_forward.id);
    assert!(stopped_remote_forward.ok);
    wait_for("remote forward teardown", || {
        read_http_body(remote_forward.remote_port).is_err()
    });

    let snippet_results = execute_native_snippet_request(SnippetExecutionRequest {
        command: "printf \"$TERMSNIP_FIXTURE\"".to_string(),
        targets: vec![
            SnippetExecutionTarget {
                host: fixture.direct_host.clone(),
                id: "direct".to_string(),
                label: "Direct".to_string(),
            },
            SnippetExecutionTarget {
                host: fixture.jump_target_host.clone(),
                id: "jump".to_string(),
                label: "Jump".to_string(),
            },
        ],
    })
    .expect("native snippet execution should succeed");
    assert_eq!(snippet_results.results.len(), 2);
    assert!(snippet_results
        .results
        .iter()
        .any(|result| result.target_id == "direct" && result.stdout.contains("direct")));
    assert!(snippet_results
        .results
        .iter()
        .any(|result| result.target_id == "jump" && result.stdout.contains("jump-target")));
}

#[test]
fn native_key_tooling_fixture_flow() {
    let root = make_fixture_root("key-tooling");
    let imported_key_path = root.join("fixture_imported_key");
    let generated_key_path = root.join("generated").join("terminal_workspace_fixture_id_ed25519");

    generate_keypair(&imported_key_path, "ed25519", Some("fixture-passphrase"));

    let imported_key = inspect_private_key(&imported_key_path.to_string_lossy())
        .expect("native key inspection should succeed");
    assert_eq!(imported_key.algorithm, "ED25519");
    assert_eq!(
        imported_key.public_key_path.as_deref(),
        Some(format!("{}.pub", imported_key_path.to_string_lossy()).as_str())
    );
    assert!(!imported_key.fingerprint.is_empty());

    let generated_key = generate_key_pair(&GenerateKeyRequest {
        comment: "termsnip-generated".to_string(),
        passphrase: "generated-passphrase".to_string(),
        path: generated_key_path.to_string_lossy().into_owned(),
        key_type: "ed25519".to_string(),
    })
    .expect("native key generation should succeed");
    assert_eq!(generated_key.algorithm, "ED25519");
    assert_eq!(generated_key.comment, "termsnip-generated");
    assert_eq!(
        generated_key.private_key_path,
        generated_key_path.to_string_lossy().into_owned()
    );
    assert!(PathBuf::from(&generated_key.private_key_path).exists());
    assert!(generated_key
        .public_key_path
        .as_ref()
        .map(PathBuf::from)
        .is_some_and(|path| path.exists()));

    let rescanned_generated_key = inspect_private_key(&generated_key.private_key_path)
        .expect("generated key should be inspectable");
    assert_eq!(
        rescanned_generated_key.fingerprint,
        generated_key.fingerprint
    );
}

#[cfg(target_os = "macos")]
#[test]
fn native_external_protocol_runtime_fixture_flow() {
    let root = make_fixture_root("external-protocols");
    let bin_dir = root.join("bin");
    fs::create_dir_all(&bin_dir).expect("fixture bin dir should be created");

    let telnet_path = bin_dir.join("telnet-fixture");
    write_fixture_executable(
        &telnet_path,
        "#!/bin/sh\nprintf 'TELNET:%s:%s\\n' \"$1\" \"$2\"\nIFS= read -r line || exit 1\nprintf 'TELNET_INPUT:%s\\n' \"$line\"\n",
    );
    let screen_path = bin_dir.join("screen-fixture");
    write_fixture_executable(
        &screen_path,
        "#!/bin/sh\nprintf 'SERIAL:%s:%s\\n' \"$1\" \"$2\"\nIFS= read -r line || exit 1\nprintf 'SERIAL_INPUT:%s\\n' \"$line\"\n",
    );
    let mosh_path = bin_dir.join("mosh-fixture");
    write_fixture_executable(
        &mosh_path,
        "#!/bin/sh\nprintf 'MOSH:%s:%s\\n' \"$1\" \"$2\"\nprintf 'password:'\nIFS= read -r secret || exit 1\nprintf 'MOSH_AUTH:%s\\n' \"$secret\"\n",
    );

    let _telnet_override = ScopedEnvVar::set("TERMSNIP_TELNET_PATH", &telnet_path);
    let _screen_override = ScopedEnvVar::set("TERMSNIP_SCREEN_PATH", &screen_path);
    let _mosh_override = ScopedEnvVar::set("TERMSNIP_MOSH_PATH", &mosh_path);

    let telnet_host = BackendHostConnection {
        agent_forwarding: false,
        auth_method: "none".to_string(),
        environment: None,
        host_key_policy: None,
        hostname: "legacy.internal".to_string(),
        jump_host: None,
        known_host_algorithm: None,
        known_host_public_key: None,
        password: String::new(),
        passphrase: String::new(),
        port: 2323,
        private_key_path: String::new(),
        protocol: "telnet".to_string(),
        sftp_root: None,
        username: String::new(),
    };
    let serial_host = BackendHostConnection {
        hostname: "/dev/cu.fixture".to_string(),
        port: 115200,
        protocol: "serial".to_string(),
        ..telnet_host.clone()
    };
    let mosh_host = BackendHostConnection {
        auth_method: "password".to_string(),
        hostname: "ops.internal".to_string(),
        password: "fixture-secret".to_string(),
        port: 60022,
        protocol: "mosh".to_string(),
        username: "ops".to_string(),
        ..telnet_host.clone()
    };

    let telnet_status = build_protocol_runtime_status("telnet");
    let serial_status = build_protocol_runtime_status("serial");
    let mosh_status = build_protocol_runtime_status("mosh");
    assert!(telnet_status.available);
    assert_eq!(telnet_status.protocol, "telnet");
    assert_eq!(telnet_status.client.as_deref(), Some("telnet"));
    assert_eq!(telnet_status.install_hint, None);
    assert_eq!(
        telnet_status.message,
        "Telnet client resolved for native session launch."
    );
    assert_eq!(
        telnet_status.resolved_path.as_deref(),
        Some(telnet_path.to_string_lossy().as_ref())
    );
    assert!(Path::new(telnet_status.resolved_path.as_deref().unwrap_or_default()).is_file());
    assert!(serial_status.available);
    assert_eq!(serial_status.protocol, "serial");
    assert_eq!(serial_status.client.as_deref(), Some("screen"));
    assert_eq!(serial_status.install_hint, None);
    assert_eq!(
        serial_status.message,
        "Serial sessions will launch with screen."
    );
    assert_eq!(
        serial_status.resolved_path.as_deref(),
        Some(screen_path.to_string_lossy().as_ref())
    );
    assert!(Path::new(serial_status.resolved_path.as_deref().unwrap_or_default()).is_file());
    assert!(mosh_status.available);
    assert_eq!(mosh_status.protocol, "mosh");
    assert_eq!(mosh_status.client.as_deref(), Some("mosh"));
    assert_eq!(mosh_status.install_hint, None);
    assert_eq!(
        mosh_status.message,
        "Mosh client resolved for native session launch."
    );
    assert_eq!(
        mosh_status.resolved_path.as_deref(),
        Some(mosh_path.to_string_lossy().as_ref())
    );
    assert!(Path::new(mosh_status.resolved_path.as_deref().unwrap_or_default()).is_file());

    let telnet_output =
        run_external_protocol_fixture(&telnet_host, "TELNET_INPUT:status", Some("status"));
    assert!(telnet_output.contains("TELNET:legacy.internal:2323"));
    assert!(telnet_output.contains("TELNET_INPUT:status"));
    assert!(telnet_output
        .replace("\r\n", "\n")
        .trim()
        .ends_with("TELNET:legacy.internal:2323\nTELNET_INPUT:status"));

    let serial_output =
        run_external_protocol_fixture(&serial_host, "SERIAL_INPUT:ping", Some("ping"));
    assert!(serial_output.contains("SERIAL:/dev/cu.fixture:115200"));
    assert!(serial_output.contains("SERIAL_INPUT:ping"));
    assert!(serial_output
        .replace("\r\n", "\n")
        .trim()
        .ends_with("SERIAL:/dev/cu.fixture:115200\nSERIAL_INPUT:ping"));

    let mosh_output = run_external_protocol_fixture(&mosh_host, "MOSH_AUTH:fixture-secret", None);
    assert!(mosh_output.contains("MOSH:ops@ops.internal:"));
    assert!(mosh_output.contains("60022"));
    assert!(mosh_output.contains("--ssh="));
    assert!(mosh_output.contains("password:"));
    assert!(mosh_output.contains("MOSH_AUTH:fixture-secret"));
}
