// Shell and environment helpers for the Node backend, factored out of
// backend.mjs so a conformance test can reach them — importing backend.mjs
// binds a port. Same reason as backend-buffers.mjs, backend-responses.mjs and
// backend-paths.mjs.
//
// #155: every function here has a name-for-name counterpart in
// src-tauri/src/native_transport.rs, and the two drifted apart unnoticed
// because nothing executed the same cases against both. They are now pinned by
// tests/fixtures/security-helper-conformance.json, which both backends read.
// A change to one side without the other fails the other side's test.

/**
 * Quote a value as a single POSIX shell word.
 *
 * #155: the spelling matters, not just the semantics. This is the
 * close-escape-reopen form `'a'\''b'`, matching `shell_single_quote` in Rust.
 * backend.mjs previously had TWO helpers for this — one emitting `'a'"'"'b'`,
 * which is equally safe but textually different, and one already emitting this
 * form. Two spellings of the same operation is how a conformance corpus becomes
 * impossible to write.
 */
export function shellSingleQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "'\\''")}'`;
}

/** A key usable as a shell identifier. Matches `is_valid_environment_key`. */
function isValidEnvironmentKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

/**
 * Filter an environment down to keys that are valid shell identifiers.
 *
 * Invalid keys are dropped rather than rejected: a host record can carry
 * anything, and refusing the whole connection over one unusable key would be a
 * worse trade than ignoring it.
 *
 * #155: the result is SORTED. Rust collected from a `HashMap`, whose iteration
 * order is unspecified and randomly seeded per process, so its export prefix
 * was textually unstable run to run and could never match JS's insertion order.
 * Ordering is semantically irrelevant here — the exports are independent
 * assignments of unique keys — but an unstable command string defeats
 * reproducibility and makes a conformance corpus impossible.
 */
export function getChannelEnvironment(environment) {
  if (!environment || typeof environment !== "object") {
    return undefined;
  }

  const entries = Object.entries(environment)
    .filter(([key]) => isValidEnvironmentKey(key))
    .map(([key, value]) => [key, String(value ?? "")])
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  if (!entries.length) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

export function buildEnvironmentExportPrefix(environment) {
  const channelEnvironment = getChannelEnvironment(environment);

  if (!channelEnvironment) {
    return "";
  }

  return Object.entries(channelEnvironment)
    .map(([key, value]) => `export ${key}=${shellSingleQuote(value)}`)
    .join("; ");
}

export function buildInteractiveShellCommand(environment) {
  const exportPrefix = buildEnvironmentExportPrefix(environment);

  if (!exportPrefix) {
    return undefined;
  }

  return `${exportPrefix}; exec "${"${SHELL:-/bin/sh}"}" -l`;
}

export function buildExecCommand(command, environment) {
  const exportPrefix = buildEnvironmentExportPrefix(environment);

  if (!exportPrefix) {
    return command;
  }

  return `${exportPrefix}; ${command}`;
}
