#!/usr/bin/env node
// `security -i` reads commands from a pipe without exposing their passwords
// through the process argument list. Send exactly one command per process so
// a later successful command cannot hide an earlier failure.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const secretNames = [
  "MACOS_CERTIFICATE_P12_BASE64",
  "MACOS_CERTIFICATE_PASSWORD",
  "MACOS_KEYCHAIN_PASSWORD",
];

export function encodeSecurityCommand(args) {
  // Apple's interactive parser uses backslash escapes inside double quotes,
  // has a 4096-byte line buffer, and accepts at most 32 arguments. It is not
  // a shell; shell quoting or JSON escaping would change some passwords.
  // Source: apple-oss-distributions/Security, SecurityTool/macOS/security.c
  if (!args.length || args.length > 32 || args.some((arg) => ["\0", "\r", "\n"].some((character) => arg.includes(character)))) {
    throw new Error("Signing input contains an unsupported command argument.");
  }
  const input = args.map((arg) => `"${arg.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`).join(" ") + "\n";
  if (Buffer.byteLength(input, "utf8") > 4000) {
    throw new Error("Signing input exceeds the macOS command length limit.");
  }
  return input;
}

export function runSigningCommand(operation, paths, { env = process.env, spawn = spawnSync } = {}) {
  const secret = (name) => {
    if (!env[name]) throw new Error(`Missing required signing secret: ${name}.`);
    return env[name];
  };
  let args;
  if (operation === "create-keychain" && paths.length === 1) {
    // secret-argv-ok: stdin command data only; the process argv below is ["-i"], verified by tests.
    args = [operation, "-p", secret("MACOS_KEYCHAIN_PASSWORD"), paths[0]];
  } else if (operation === "unlock-keychain" && paths.length === 1) {
    // secret-argv-ok: stdin command data only; the process argv below is ["-i"], verified by tests.
    args = [operation, "-p", secret("MACOS_KEYCHAIN_PASSWORD"), paths[0]];
  } else if (operation === "import" && paths.length === 2) {
    args = [operation, paths[0], "-P", secret("MACOS_CERTIFICATE_PASSWORD"), "-A", "-t", "cert", "-f", "pkcs12", "-k", paths[1]];
  } else if (operation === "set-key-partition-list" && paths.length === 1) {
    args = [operation, "-S", "apple-tool:,apple:,codesign:", "-s", "-k", secret("MACOS_KEYCHAIN_PASSWORD"), paths[0]];
  } else {
    throw new Error("Unsupported signing operation or path count.");
  }

  const childEnv = { ...env };
  for (const name of secretNames) delete childEnv[name];
  const result = spawn("/usr/bin/security", ["-i"], {
    input: encodeSecurityCommand(args),
    encoding: "utf8",
    env: childEnv,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  // Never forward captured output: a platform error could echo its input.
  if (result.error || result.status !== 0) {
    throw new Error(`macOS signing setup failed during ${operation}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runSigningCommand(process.argv[2], process.argv.slice(3));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "macOS signing setup failed.");
    process.exitCode = 1;
  }
}
