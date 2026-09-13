#!/usr/bin/env node
// #319: no secret value may be passed as a process argument.
//
// macOS and Linux expose every process's argv to other local processes (`ps`,
// KERN_PROCARGS2, /proc/*/cmdline), so a secret on argv is transiently
// world-readable. This repo fixed four instances of that shape one at a time
// (ssh-keygen -N, gh secret set --body, security add-generic-password -w, and
// the key-generation -N found while writing this gate). This is the mechanism
// that finds the fifth before it merges: a static scan of every place the repo
// builds a command line, in all three languages, for a known secret-bearing
// option followed by a runtime value.
//
// A LITERAL value after the option is allowed — `-N ""` (no passphrase) and
// fixture constants are not secrets. A variable, expression or substitution is
// flagged. Suppress a genuine false positive with
//   // secret-argv-ok: <reason>     (Rust / JS)
//   # secret-argv-ok: <reason>      (shell)
// on the same line or the line above. Test modules are skipped (fixtures are
// not secrets): `*_fixtures.rs`, `*_tests.rs`, `*.test.*`, and everything after
// a `#[cfg(test)] mod tests` header in a Rust file.
//
// Usage: node scripts/secret-argv-check.mjs [--root DIR]   (exit 1 on findings)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Option → the tool(s) it is secret-bearing for. The tool list is advisory
// (a line mentioning none of them is still checked when the option is one that
// only ever carries a secret, e.g. --password); it exists so `-p` for ssh's
// port or `-w` for other tools does not fire.
export const SECRET_OPTIONS = [
  { option: "-N", tools: ["ssh-keygen"], why: "new passphrase" },
  { option: "-P", tools: ["ssh-keygen"], why: "old passphrase" },
  { option: "-w", tools: ["security"], why: "keychain item password" },
  // `security -p` is a password only for create-keychain / unlock-keychain
  // (`find-identity -p` is a policy name); match on the subcommand instead.
  { option: "-p", tools: ["create-keychain", "unlock-keychain", "sshpass", "notarytool"], why: "password" },
  { option: "--body", tools: ["gh"], why: "secret value (use --body-file or stdin)" },
  { option: "--password", tools: [], why: "password" },
  { option: "--apple-id-password", tools: [], why: "password" },
  { option: "--token", tools: [], why: "token" },
  { option: "--pass", tools: ["openssl"], why: "password" },
  { option: "-passin", tools: ["openssl"], why: "password" },
  { option: "-passout", tools: ["openssl"], why: "password" },
  { option: "-u", tools: ["curl"], why: "user:password" },
  { option: "--user", tools: ["curl"], why: "user:password" },
];

const SUPPRESS = /secret-argv-ok:\s*\S/;
const KNOWN = /secret-argv-known:\s*#\d+/;
const KNOWN_ALLOWLIST = "scripts/secret-argv-known.json";

function isRustTestFile(name) {
  return /_fixtures\.rs$|_tests\.rs$/.test(name);
}

function isJsTestFile(name) {
  return /\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/.test(name);
}

/** Lines of a Rust file up to (not including) its `#[cfg(test)] mod tests` block. */
function productionLines(file, lines) {
  if (!file.endsWith(".rs")) return lines.length;
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (/^\s*#\[cfg\((all\()?test\b[^\]]*\]\s*$/.test(lines[i]) && /^\s*(pub(\(crate\))? )?mod \w+\s*\{/.test(lines.slice(i + 1, i + 4).join(" "))) {
      return i;
    }
  }
  return lines.length;
}

function toolMentioned(context, tools) {
  if (tools.length === 0) return true;
  // `ssh-keygen` also matches `run_ssh_keygen(` / `sshKeygen` — the identifier a
  // Rust or JS helper is named after when the Command::new lives elsewhere.
  const norm = context.replace(/[-_]/g, "").toLowerCase();
  return tools.some((tool) => norm.includes(tool.replace(/[-_]/g, "").toLowerCase()));
}

/** True when `value` (the token after the option) is a literal, not a runtime value. */
function isLiteral(value) {
  const v = value.trim();
  if (v === "") return true;
  if (/^""|^''$/.test(v)) return true;
  if (/^'[^'$`]*'$/.test(v)) return true; // shell single-quoted literal
  if (/^"[^"$`\\]*"$/.test(v)) return true; // double-quoted, no expansion
  if (/^"[^"$`\\]*"\.to_string\(\)$/.test(v)) return true; // Rust literal.to_string()
  if (/^"[^"$`\\]*"\.to_owned\(\)$/.test(v)) return true;
  return false;
}

/**
 * Find (option, next-token) pairs on a line. Handles the three shapes the repo
 * uses: shell words (`-N "$X"` / `--body=$X`), JS/Rust array elements
 * (`"-N", value` / `"-N".to_string(), value`), and Rust `.arg("-N").arg(value)`.
 */
function pairsOnLine(line, nextLine, following) {
  const pairs = [];
  for (const { option, tools, why } of SECRET_OPTIONS) {
    const esc = option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // shell: -N value  |  --body=value
    for (const m of line.matchAll(new RegExp(`(?:^|[\\s(])${esc}(?:=|\\s+)([^\\s;|&)]+)`, "g"))) {
      pairs.push({ option, tools, why, value: m[1], shape: "shell" });
    }
    // array element: "-N", value    (JS or Rust; Rust may add .to_string())
    for (const m of line.matchAll(new RegExp(`["']${esc}["'](?:\\.to_string\\(\\)|\\.to_owned\\(\\))?\\s*,\\s*([^,\\]]+)`, "g"))) {
      pairs.push({ option, tools, why, value: m[1], shape: "array" });
    }
    // array element where the value is on the NEXT line: "-N".to_string(),\n value,
    if (new RegExp(`["']${esc}["'](?:\\.to_string\\(\\)|\\.to_owned\\(\\))?\\s*,\\s*$`).test(line) && nextLine !== undefined) {
      const next = nextLine.trim().replace(/,\s*$/, "");
      // The option was the LAST element (value supplied via stdin/file) when the
      // array closes on the next line.
      if (!/^[\])}]/.test(next)) pairs.push({ option, tools, why, value: next, shape: "array-next" });
    }
    // Rust builder: .arg("-N").arg(value)  — same line
    for (const m of line.matchAll(new RegExp(`\\.arg\\(["']${esc}["']\\)\\s*\\.arg\\(([^)]*)\\)`, "g"))) {
      pairs.push({ option, tools, why, value: m[1], shape: "builder" });
    }
    // Rust builder / Vec: `.arg("-N");` or `.push("-N".to_string());` as its own
    // statement — the value is whatever the NEXT .arg/.push statement carries,
    // even with blank or comment lines in between.
    if (new RegExp(`\\.(arg|push)\\(["']${esc}["'](?:\\.to_string\\(\\)|\\.to_owned\\(\\))?\\);\\s*$`).test(line) && following) {
      // Unrelated statements may sit between the option and its value; take
      // the FIRST later .arg/.push (a different command in between would be a
      // suppressible false positive, which is the safe direction).
      for (const candidate of following) {
        const m = candidate.match(/\.(?:arg|push)\(([^)]*)\);/);
        if (!m) continue;
        pairs.push({ option, tools, why, value: m[1], shape: "statement-next" });
        break;
      }
    }
    // Concatenation: format!("-N{}", p) / format!("--password={}", p) /
    // `--password=${p}` / "-N" + p — the value is glued to the option.
    for (const m of line.matchAll(new RegExp(`["'\`]${esc}=?(?:\\{\\}|\\$\\{([^}]+)\\})`, "g"))) {
      const fmtArg = line.match(/format!\([^,]+,\s*([^)]+)\)/);
      pairs.push({ option, tools, why, value: m[1] ?? (fmtArg ? fmtArg[1] : "<interpolated>"), shape: "concat" });
    }
    for (const m of line.matchAll(new RegExp(`["']${esc}["']\\s*\\+\\s*([A-Za-z_$][\\w$.]*)`, "g"))) {
      pairs.push({ option, tools, why, value: m[1], shape: "concat" });
    }
  }
  return pairs;
}

export function scanSource(file, source) {
  const findings = [];
  const lines = source.split("\n");
  const limit = productionLines(file, lines);
  for (let i = 0; i < limit; i += 1) {
    const line = lines[i];
    if (/^\s*(\/\/|#)/.test(line) && !/^\s*#\s*!/.test(line)) continue; // comment lines
    if (SUPPRESS.test(line) || (i > 0 && SUPPRESS.test(lines[i - 1]))) continue;
    const known = (line.match(KNOWN) || (i > 0 && lines[i - 1].match(KNOWN)) || [null])[0];
    // tool context: a window around the line (multi-line arg arrays; a helper
    // named after the tool may consume the array a few lines below).
    const context = lines.slice(Math.max(0, i - 30), Math.min(lines.length, i + 20)).join("\n");
    for (const pair of pairsOnLine(line, lines[i + 1], lines.slice(i + 1, i + 6))) {
      if (!toolMentioned(context, pair.tools)) continue;
      if (isLiteral(pair.value)) continue;
      findings.push({ file, line: i + 1, option: pair.option, value: pair.value.trim(), why: pair.why, known: known ? known.replace(/.*#/, "#") : null });
    }
  }
  return findings;
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "target" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
}

export function scanRepo(root) {
  const files = [];
  for (const sub of ["scripts", "src-tauri/src", "apps/desktop/server"]) {
    try {
      walk(join(root, sub), files);
    } catch {
      /* optional dir */
    }
  }
  const findings = [];
  for (const full of files) {
    const rel = relative(root, full);
    const base = rel.split("/").pop();
    if (!/\.(sh|mjs|cjs|js|ts|rs)$/.test(base)) continue;
    if (isRustTestFile(base) || isJsTestFile(base)) continue;
    if (rel === "scripts/secret-argv-check.mjs") continue;
    findings.push(...scanSource(rel, readFileSync(full, "utf8")));
  }
  return findings;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const rootFlag = process.argv.indexOf("--root");
  const root = rootFlag > -1 ? process.argv[rootFlag + 1] : join(fileURLToPath(new URL(".", import.meta.url)), "..");
  const findings = scanRepo(root);
  const allowlist = (() => {
    try {
      return JSON.parse(readFileSync(join(root, KNOWN_ALLOWLIST), "utf8"));
    } catch {
      return [];
    }
  })();
  const today = new Date().toISOString().slice(0, 10);
  const known = [];
  const blocking = [];
  for (const f of findings) {
    const entry = f.known && allowlist.find((e) => e.file === f.file && e.option === f.option && `#${e.ticket}` === f.known);
    if (!f.known) blocking.push(f);
    else if (!entry) blocking.push({ ...f, why: `${f.why}; marker ${f.known} has no entry in ${KNOWN_ALLOWLIST}` });
    else if (entry.expires && entry.expires < today) blocking.push({ ...f, why: `${f.why}; ${KNOWN_ALLOWLIST} entry for ${f.known} expired ${entry.expires}` });
    else known.push(f);
  }
  for (const f of known) {
    console.warn(`${f.file}:${f.line}: known secret on argv (${f.why}), tracked by ${f.known}: \`${f.option} ${f.value}\``);
  }
  if (blocking.length === 0) {
    console.log(`[secret-argv-check] ok: no NEW secret-bearing option carries a runtime value on argv (${known.length} known, tracked)`);
    process.exit(0);
  }
  for (const f of blocking) {
    console.error(`${f.file}:${f.line}: \`${f.option} ${f.value}\` puts a ${f.why} on argv (visible to every local process). Pass it via stdin, a 0600 file, or SSH_ASKPASS — or annotate \`secret-argv-ok: <reason>\` if it is provably not a secret.`);
  }
  console.error(`[secret-argv-check] ${blocking.length} new finding(s). See #319.`);
  process.exit(1);
}
