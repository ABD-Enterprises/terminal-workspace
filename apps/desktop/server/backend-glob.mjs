// #MAINT-1: the `Include` glob matcher for `~/.ssh/conf.d/*` patterns.
//
// This must agree with the Rust `glob_match` in `src-tauri/src/main.rs`, which
// is the shipping transport (docs/architecture.md). Rust matches on Unicode
// scalar values, so `?` consumes exactly one code point and `*` matches any
// run of them — a newline included. A JavaScript regex without the `u` flag
// consumes one UTF-16 code unit and never matches a newline, so the same SSH
// config produced a different host set per backend: a filename containing an
// astral character was matched natively and skipped in browser mode.
//
// `u` makes `.` consume one code point; `s` lets it match a newline. The `u`
// flag also changed how an unpaired surrogate in the pattern is treated across
// V8 versions, so an invalid pattern is skipped explicitly instead of being
// able to crash the request.

/**
 * Build the matcher for one glob pattern, or null when the pattern cannot be
 * expressed as a Unicode regex.
 */
export function globMatcher(pattern) {
  let source = "^";
  for (const char of pattern) {
    if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  // Safe dynamic regex: `source` is built from the user's own ~/.ssh Include
  // glob with every literal char regex-escaped above; only `*`/`?` become
  // `.*`/`.`. Input is local + trusted (not attacker-facing) and matches are
  // capped (SSH_CONFIG_GLOB_MAX_MATCHES), so this is not a ReDoS vector.
  try {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp,semgrep.rules.javascript.lang.security.audit.detect-non-literal-regexp
    return new RegExp(`${source}$`, "us");
  } catch {
    // Older V8 threw a SyntaxError here for an unpaired surrogate under the
    // `u` flag; current V8 accepts it and matches it. Rust has no equivalent
    // case — a Rust `str` cannot hold a lone surrogate — so a pattern that
    // cannot be built is skipped rather than matched, and the caller treats
    // it as matching nothing.
    return null;
  }
}

/**
 * True when `text` matches `pattern` under the Rust-compatible semantics.
 * A pattern that cannot be expressed as a Unicode regex matches nothing.
 */
export function globMatches(pattern, text) {
  const matcher = globMatcher(pattern);
  return matcher === null ? false : matcher.test(text);
}
