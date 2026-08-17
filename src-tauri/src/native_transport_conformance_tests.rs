//! #155: the Rust half of the cross-backend conformance suite.
//!
//! The same security-relevant helpers exist independently in this crate and in
//! `apps/desktop/server/backend-shell.mjs` / `backend-paths.mjs`. Nothing ever
//! executed the same inputs against both, and they drifted: trailing slashes,
//! a bare `.`, whitespace-only paths, astral filenames, and shell-quote
//! spelling all disagreed.
//!
//! Both sides now read `tests/fixtures/security-helper-conformance.json`. The
//! expectations there are hand-authored, not captured from either backend — a
//! golden taken from one side would have made that side the oracle and blessed
//! exactly those bugs.
//!
//! If you change a helper here, the JS conformance test fails until its
//! counterpart matches, and vice versa. That is the whole point.

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::Value;

use crate::native_transport::{
    build_environment_export_prefix, build_exec_command, build_interactive_shell_command,
    get_channel_environment, normalize_remote_path, resolve_remote_path, sanitize_filename,
    shell_single_quote,
};

fn fixture() -> Value {
    // CARGO_MANIFEST_DIR is src-tauri/, so the repo root is its parent.
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri always has a parent")
        .join("tests/fixtures/security-helper-conformance.json");
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!("conformance fixture must be readable at {path:?}: {error}")
    });
    serde_json::from_str(&raw).expect("conformance fixture must be valid JSON")
}

/// A group that silently has no cases would make this suite pass while proving
/// nothing, so every accessor asserts it found some.
fn cases<'a>(fixture: &'a Value, group: &str) -> &'a Vec<Value> {
    let list = fixture
        .get(group)
        .unwrap_or_else(|| panic!("fixture is missing the `{group}` group"))
        .as_array()
        .unwrap_or_else(|| panic!("`{group}` must be an array"));
    assert!(!list.is_empty(), "`{group}` must not be empty");
    list
}

fn text(case: &Value, field: &str) -> String {
    case.get(field)
        .unwrap_or_else(|| panic!("case is missing `{field}`: {case}"))
        .as_str()
        .unwrap_or_else(|| panic!("`{field}` must be a string: {case}"))
        .to_string()
}

/// Fixture environments are ordered PAIRS, not JSON objects: the JS harness
/// needs a deliberate input order to prove sorting happens, and a JSON object
/// cannot guarantee one.
fn environment_map(case: &Value) -> Option<HashMap<String, String>> {
    let pairs = case
        .get("input")
        .and_then(Value::as_array)
        .expect("environment case needs an `input` array of pairs");
    let map: HashMap<String, String> = pairs
        .iter()
        .map(|pair| {
            let pair = pair.as_array().expect("each entry is a [key, value] pair");
            (
                pair[0].as_str().expect("key is a string").to_string(),
                pair[1].as_str().expect("value is a string").to_string(),
            )
        })
        .collect();
    Some(map)
}

#[test]
fn normalize_remote_path_matches_the_shared_corpus() {
    let fixture = fixture();
    for case in cases(&fixture, "normalizeRemotePath") {
        let input = text(case, "input");
        assert_eq!(
            normalize_remote_path(&input),
            text(case, "expected"),
            "normalize_remote_path({input:?}) — {}",
            text(case, "why")
        );
    }
}

#[test]
fn resolve_remote_path_matches_the_shared_corpus() {
    let fixture = fixture();
    for case in cases(&fixture, "resolveRemotePath") {
        let root = text(case, "root");
        let input = text(case, "input");
        assert_eq!(
            resolve_remote_path(&root, &input),
            text(case, "expected"),
            "resolve_remote_path({root:?}, {input:?}) — {}",
            text(case, "why")
        );
    }
}

#[test]
fn sanitize_filename_matches_the_shared_corpus() {
    let fixture = fixture();
    for case in cases(&fixture, "sanitizeFilename") {
        let input = text(case, "input");
        assert_eq!(
            sanitize_filename(&input),
            text(case, "expected"),
            "sanitize_filename({input:?}) — {}",
            text(case, "why")
        );
    }
}

#[test]
fn shell_single_quote_matches_the_shared_corpus() {
    let fixture = fixture();
    for case in cases(&fixture, "shellSingleQuote") {
        let input = text(case, "input");
        assert_eq!(
            shell_single_quote(&input),
            text(case, "expected"),
            "shell_single_quote({input:?}) — {}",
            text(case, "why")
        );
    }
}

#[test]
fn environment_helpers_match_the_shared_corpus() {
    let fixture = fixture();
    for case in cases(&fixture, "environment") {
        let why = text(case, "why");
        let environment = environment_map(case);
        let command = text(case, "command");

        let expected_entries: Vec<(String, String)> = case["expectedEntries"]
            .as_array()
            .expect("expectedEntries is an array")
            .iter()
            .map(|pair| {
                let pair = pair.as_array().expect("pair");
                (
                    pair[0].as_str().expect("key").to_string(),
                    pair[1].as_str().expect("value").to_string(),
                )
            })
            .collect();

        let actual_entries = get_channel_environment(&environment).unwrap_or_default();
        assert_eq!(actual_entries, expected_entries, "entries — {why}");

        assert_eq!(
            build_environment_export_prefix(&environment),
            text(case, "expectedExportPrefix"),
            "export prefix — {why}"
        );

        let expected_shell = case["expectedInteractiveShellCommand"]
            .as_str()
            .map(str::to_string);
        assert_eq!(
            build_interactive_shell_command(&environment),
            expected_shell,
            "interactive shell command — {why}"
        );

        assert_eq!(
            build_exec_command(&command, &environment),
            text(case, "expectedExecCommand"),
            "exec command — {why}"
        );
    }
}

/// The quoted form must survive a real shell as ONE literal word. Asserting the
/// spelling alone would pass for a spelling that happens to be wrong.
#[test]
fn quoted_values_round_trip_through_a_real_shell() {
    let fixture = fixture();
    for case in cases(&fixture, "shellSingleQuote") {
        let input = text(case, "input");
        let quoted = shell_single_quote(&input);
        let output = std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(format!("printf %s {quoted}"))
            .output()
            .expect("sh must run");
        assert!(output.status.success(), "sh failed for {input:?}");
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            input,
            "{quoted} must reach the shell as the literal {input:?}"
        );
    }
}
